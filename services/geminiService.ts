
import { GoogleGenAI, Type } from "@google/genai";

const MODEL_NAME = 'gemini-3-flash-preview';

async function retryWithBackoff<T>(fn: () => Promise<T>, retries = 5, initialDelay = 3000): Promise<T> {
  let delay = initialDelay;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const isQuotaExceeded = error.message?.includes("429") || error.status === 429 || error.message?.includes("RESOURCE_EXHAUSTED");
      const isRetryable = isQuotaExceeded || (error.status >= 500 && error.status < 600);
      
      if (i < retries - 1 && isRetryable) {
        const waitTime = isQuotaExceeded ? delay * (i + 1.5) : delay;
        console.warn(`[Gemini API] Retrying (${i + 1}/${retries}) in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        delay *= 2; 
        continue;
      }
      throw error;
    }
  }
  return fn();
}

export async function analyzeQuestionImage(base64Image: string): Promise<any> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    Analyze this exam question image and provide a TRILINGUAL output (Portuguese, English, Spanish).
    1. Extract question text and translate it to all 3 languages.
    2. Extract all options (A, B, C, D, E) and translate each one to all 3 languages.
    3. Identify the correct answer letter.
    4. Provide a detailed pedagogical explanation in all 3 languages.
    
    CRITICAL: Ensure technical terms are translated accurately according to professional exam standards.
  `;

  const languageObjectSchema = {
    type: Type.OBJECT,
    properties: {
      pt: { type: Type.STRING },
      en: { type: Type.STRING },
      es: { type: Type.STRING },
    },
    required: ["pt", "en", "es"]
  };

  const optionsLanguageSchema = {
    type: Type.OBJECT,
    properties: {
      pt: { 
        type: Type.OBJECT, 
        properties: { A: {type: Type.STRING}, B: {type: Type.STRING}, C: {type: Type.STRING}, D: {type: Type.STRING}, E: {type: Type.STRING} }
      },
      en: { 
        type: Type.OBJECT, 
        properties: { A: {type: Type.STRING}, B: {type: Type.STRING}, C: {type: Type.STRING}, D: {type: Type.STRING}, E: {type: Type.STRING} }
      },
      es: { 
        type: Type.OBJECT, 
        properties: { A: {type: Type.STRING}, B: {type: Type.STRING}, C: {type: Type.STRING}, D: {type: Type.STRING}, E: {type: Type.STRING} }
      },
    },
    required: ["pt", "en", "es"]
  };

  return retryWithBackoff(async () => {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: base64Image.split(',')[1] || base64Image,
            },
          },
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            question: languageObjectSchema,
            options: optionsLanguageSchema,
            correctAnswer: { type: Type.STRING },
            explanations: languageObjectSchema,
          },
          required: ["question", "options", "correctAnswer", "explanations"]
        }
      }
    });

    try {
      const text = response.text;
      if (!text) throw new Error("Empty response");
      return JSON.parse(text);
    } catch (e) {
      console.error("Parse Error", e);
      throw new Error("Invalid AI response format");
    }
  });
}
