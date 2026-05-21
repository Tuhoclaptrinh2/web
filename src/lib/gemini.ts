import { GoogleGenAI } from "@google/genai";
import { RuleMapping, PronounRule } from "../types";

// Initialize the Gemini AI client lazily to avoid startup crashes if key is missing
let aiClient: GoogleGenAI | null = null;
let currentApiKey: string | null = null;

export const setCustomApiKey = (key: string) => {
  if (key) {
    localStorage.setItem("custom_gemini_api_key", key);
  } else {
    localStorage.removeItem("custom_gemini_api_key");
  }
  aiClient = null; // force re-initialization
};

export const getCustomApiKey = () => {
  return localStorage.getItem("custom_gemini_api_key") || "";
};

const getAI = () => {
  const customKey = getCustomApiKey();
  const apiKey = customKey || (process.env.GEMINI_API_KEY as string) || "";

  if (aiClient && currentApiKey === apiKey) return aiClient;

  currentApiKey = apiKey;
  aiClient = new GoogleGenAI({ apiKey });
  return aiClient;
};

export async function translateNovelText(
  text: string,
  genres: string[],
  names: RuleMapping[],
  pronouns: PronounRule[],
  onChunk?: (text: string) => void,
  modelName: string = "gemini-2.5-flash",
  abortSignal?: AbortSignal,
  sourceLanguage: string = "Tiếng Trung"
): Promise<string> {
  if (!text || !text.trim()) return "";

  const ai = getAI();

  // Prepare rules
  const namesRules = names.filter(n => n.zh?.trim() && n.vi?.trim());
  const pronounsRules = pronouns.filter(p => p.speaker?.trim() || p.listener?.trim());

  const namesPrompt = namesRules.length > 0 
    ? namesRules.map(n => `- "${n.zh}" -> "${n.vi}"`).join("\n")
    : "- Không có danh từ riêng đặc biệt.";

  const pronounsPrompt = pronounsRules.length > 0
    ? pronounsRules.map(p => `- ${p.speaker} gọi ${p.listener}: Xưng "${p.selfPronoun}", gọi "${p.otherPronoun}"`).join("\n")
    : "- Tự dịch xưng hô phù hợp.";

  const genresPrompt = genres.length > 0 ? genres.join(", ") : "Tiểu thuyết";

  try {
    const systemInstruction = `Bạn là biên dịch viên chuyên nghiệp phiên dịch tiểu thuyết ${sourceLanguage} sang tiếng Việt.
Mục tiêu: Dịch tiểu thuyết mượt mà, tự nhiên, 100% TIẾNG VIỆT, dễ hiểu.

ĐẶC BIỆT LƯU Ý VÀ BẮT BUỘC: 
- Bạn PHẢI dịch ĐẦY ĐỦ từng câu, từng đoạn văn từ bản raw.
- TUYỆT ĐỐI KHÔNG TÓM TẮT.
- TUYỆT ĐỐI KHÔNG LƯỢC BỎ bất kỳ câu thoại, đoạn miêu tả hay chi tiết nhỏ nào (dù văn bản có dài đến đâu).
- LUÔN LUÔN bảo toàn số lượng dòng chữ và chỗ xuống dòng.

QUY TẮC DỊCH THUẬT:
1. LUÔN BÁM SÁT NGUYÊN TÁC: Dịch 1:1 ý nghĩa, giữ nguyên cấu trúc số lượng câu và đoạn văn của bản gốc.
2. TUYỆT ĐỐI KHÔNG để sót chữ gốc. Dùng âm phiên âm (chữ La-tinh) cho các từ hoặc tên không thể dịch ra nghĩa Việt.
3. BẢO TOÀN ĐỊNH DẠNG: Xuống dòng y hệt bản gốc. Không tự ý gộp đoạn, gộp dòng. Giữ nguyên các dòng trống.
4. TUÂN THỦ DANH TỪ RIÊNG:
${namesPrompt}
5. TUÂN THỦ XƯNG HÔ:
${pronounsPrompt}
- THỂ LOẠI / BỐI CẢNH: ${genresPrompt}. Hệ thống dịch thuật cần tuân thủ nghiêm ngặt văn phong và từ vựng đặc trưng của thể loại này.`;

    const finalPrompt = `Hãy dịch bộ văn bản ${sourceLanguage} sau sang tiếng Việt. 
Yêu cầu bắt buộc: 
- Dịch đầy đủ và chi tiết nhất có thể, tuyệt đối không được phép tóm tắt.
- Tuyệt đối không được phép cắt xén bất cứ một dòng hay đoạn miêu tả nào.
- Giữ vững toàn bộ mạch văn và văn phong tĩnh/động của bối cảnh đã cung cấp.

VĂN BẢN GỐC:
${text}

---- BẢN DỊCH TIẾNG VIỆT ĐẦY ĐỦ: ---`;

    console.log(`[Stream] Starting translation with model: ${modelName}`);
    
    const responseStream = await ai.models.generateContentStream({
      model: modelName,
      contents: finalPrompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.2,
        abortSignal: abortSignal,
        safetySettings: [
          { category: "HARM_CATEGORY_HATE_SPEECH" as any, threshold: "BLOCK_NONE" as any },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT" as any, threshold: "BLOCK_NONE" as any },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT" as any, threshold: "BLOCK_NONE" as any },
          { category: "HARM_CATEGORY_HARASSMENT" as any, threshold: "BLOCK_NONE" as any }
        ]
      },
    });

    let fullText = "";
    let lastUpdateTime = 0;
    const UPDATE_INTERVAL = 100;

    for await (const chunk of responseStream) {
      if (chunk.text) {
        fullText += chunk.text;
        const now = Date.now();
        if (onChunk && (now - lastUpdateTime > UPDATE_INTERVAL)) {
          onChunk(fullText);
          lastUpdateTime = now;
        }
      }
    }
    
    const finalNormalized = fullText.normalize("NFC");
    if (onChunk) onChunk(finalNormalized);
    return finalNormalized;
  } catch (error: any) {
    console.error("Translation ERROR:", error);
    const msg = error?.message || "";
    if (msg.includes("429") || msg.toLowerCase().includes("quota")) {
      throw new Error("Đã hết giới hạn API (Quota Exceeded). Model Gemini sẽ reset lại quota vào lúc 7h sáng mỗi ngày (giờ Việt Nam). Vui lòng quay lại sau lúc 7h sáng hoặc đổi tài khoản/API Key khác nhé.");
    }
    throw new Error(msg || "Lỗi khi kết nối tới AI. Vui lòng thử lại hoặc kiểm tra cấu hình.");
  }
}

export async function extractRulesFromTranslation(
  sourceText: string,
  translatedText: string,
  modelName: string = "gemini-2.5-flash",
  sourceLanguage: string = "Tiếng Trung"
): Promise<{ 
  names: { zh: string, vi: string }[], 
  pronouns: { speaker: string, listener: string, selfPronoun: string, otherPronoun: string }[] 
}> {
  const prompt = `Dưới đây là một đoạn văn bản gốc ${sourceLanguage} và bản dịch tiếng Việt.
Hãy trích xuất:
1. Các danh từ riêng quan trọng (tên người, địa danh, vật phẩm, chiêu thức). Phải có cả từ gốc (${sourceLanguage}) và tiếng Việt.
2. Quy tắc xưng hô: Mối quan hệ giữa 2 người, và cách họ xưng hô (dựa vào bản dịch).

TRẢ VỀ KẾT QUẢ DƯỚI DẠNG JSON THEO CẤU TRÚC SAU:
{
  "names": [{"zh": "từ bản gốc", "vi": "tiếng Việt"}],
  "pronouns": [{"speaker": "Người A", "listener": "Người B", "selfPronoun": "cách A tự xưng", "otherPronoun": "cách A gọi B"}]
}

VĂN BẢN GỐC: ${sourceText.substring(0, 3000)}
BẢN DỊCH: ${translatedText.substring(0, 3000)}`;

  const ai = getAI();
  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        systemInstruction: "Bạn là trợ lý trích xuất dữ liệu. Chỉ trả về JSON, không giải thích.",
        safetySettings: [
          { category: "HARM_CATEGORY_HATE_SPEECH" as any, threshold: "BLOCK_NONE" as any },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT" as any, threshold: "BLOCK_NONE" as any },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT" as any, threshold: "BLOCK_NONE" as any },
          { category: "HARM_CATEGORY_HARASSMENT" as any, threshold: "BLOCK_NONE" as any }
        ]
      }
    });

    const text = response.text || "{}";
    const cleanJson = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const data = JSON.parse(cleanJson);
    return {
      names: Array.isArray(data.names) ? data.names : [],
      pronouns: Array.isArray(data.pronouns) ? data.pronouns : []
    };
  } catch (error: any) {
    console.error("Extraction error:", error);
    const msg = error?.message || "";
    if (msg.includes("429") || msg.toLowerCase().includes("quota")) {
      throw new Error("Đã hết giới hạn API (Quota Exceeded). Model Gemini sẽ reset lại quota vào lúc 7h sáng mỗi ngày (giờ Việt Nam). Vui lòng quay lại sau lúc 7h sáng hoặc đổi tài khoản/API Key khác nhé.");
    }
    return { names: [], pronouns: [] };
  }
}

export async function extractRulesFromContext(
  contextText: string,
  modelName: string = "gemini-2.5-flash",
  sourceLanguage: string = "Tiếng Trung"
): Promise<{ 
  names: { zh?: string, vi: string }[], 
  pronouns: { speaker: string, listener: string, selfPronoun: string, otherPronoun: string }[] 
}> {
  const prompt = `Dưới đây là một đoạn trích truyện dịch. Hãy phân tích và trích xuất các quy tắc dịch thuật để dùng cho các chương sau.

1. Danh từ riêng (Tên nhân vật, địa danh, vật phẩm, chiêu thức). Tìm tên tiếng Việt, nếu đoán được từ bản gốc (${sourceLanguage}) thì ghi, không thì để trống.
2. Quy tắc xưng hô: Mối quan hệ giữa 2 người, và cách họ xưng hô.

VĂN BẢN:
${contextText.substring(0, 5000)}

TRẢ VỀ KẾT QUẢ DƯỚI DẠNG JSON THEO CẤU TRÚC SAU (không có thêm văn bản nào khác):
{
  "names": [{"zh": "từ bản gốc (nếu có thể đoán)", "vi": "tên tiếng việt"}],
  "pronouns": [{"speaker": "Người A", "listener": "Người B (hoặc 'chung')", "selfPronoun": "cách A tự xưng (VD: ta)", "otherPronoun": "cách A gọi B (VD: ngươi)"}]
}`;

  const ai = getAI();
  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        systemInstruction: "Bạn là trợ lý trích xuất quy tắc dịch thuật. Chỉ trả về JSON thuần túy.",
        temperature: 0.1,
        safetySettings: [
          { category: "HARM_CATEGORY_HATE_SPEECH" as any, threshold: "BLOCK_NONE" as any },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT" as any, threshold: "BLOCK_NONE" as any },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT" as any, threshold: "BLOCK_NONE" as any },
          { category: "HARM_CATEGORY_HARASSMENT" as any, threshold: "BLOCK_NONE" as any }
        ]
      }
    });

    const text = response.text || "{}";
    const cleanJson = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const data = JSON.parse(cleanJson);
    return {
      names: Array.isArray(data.names) ? data.names : [],
      pronouns: Array.isArray(data.pronouns) ? data.pronouns : []
    };
  } catch (error: any) {
    console.error("Extraction rules error:", error);
    const msg = error?.message || "";
    if (msg.includes("429") || msg.toLowerCase().includes("quota")) {
      throw new Error("Đã hết giới hạn API (Quota Exceeded). Model Gemini sẽ reset lại quota vào lúc 7h sáng mỗi ngày (giờ Việt Nam). Vui lòng quay lại sau lúc 7h sáng hoặc đổi tài khoản/API Key khác nhé.");
    }
    return { names: [], pronouns: [] };
  }
}
