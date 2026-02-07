
import { GoogleGenAI, Type } from "@google/genai";

const MODEL_NAME = 'gemini-3-flash-preview';

// Lógica de retry com backoff exponencial aprimorada para limites de cota
async function retryWithBackoff<T>(fn: () => Promise<T>, retries = 5, initialDelay = 3000): Promise<T> {
  let delay = initialDelay;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      // Verifica se o erro é de cota excedida (429) ou erro interno de servidor (5xx)
      const isQuotaExceeded = error.message?.includes("429") || error.status === 429 || error.message?.includes("RESOURCE_EXHAUSTED");
      const isRetryable = isQuotaExceeded || (error.status >= 500 && error.status < 600);
      
      if (i < retries - 1 && isRetryable) {
        // Se for erro de cota, o delay aumenta mais rapidamente
        const waitTime = isQuotaExceeded ? delay * (i + 1.5) : delay;
        console.warn(`[Gemini API] Limite atingido ou erro. Tentativa ${i + 1}/${retries}. Aguardando ${waitTime}ms...`);
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
    Analyze this exam question image. 
    1. Extract the question text.
    2. Extract the multiple choice options (A, B, C, D, etc.).
    3. Identify the correct answer (A, B, C, D, etc.).
    4. Provide a detailed explanation of why that answer is correct and why the others are wrong in Portuguese.
    5. Provide the same detailed explanation in English.
    
    Output MUST be in the specified JSON format.
  `;

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
            question: { type: Type.STRING },
            options: {
              type: Type.OBJECT,
              properties: {
                A: { type: Type.STRING },
                B: { type: Type.STRING },
                C: { type: Type.STRING },
                D: { type: Type.STRING },
                E: { type: Type.STRING },
              }
            },
            correctAnswer: { type: Type.STRING, description: "Single letter representing the correct option" },
            explanationPT: { type: Type.STRING },
            explanationEN: { type: Type.STRING },
          },
          required: ["question", "options", "correctAnswer", "explanationPT", "explanationEN"]
        }
      }
    });

    try {
      const text = response.text;
      if (!text) throw new Error("Empty response from AI");
      return JSON.parse(text);
    } catch (e) {
      console.error("Failed to parse Gemini response", e);
      throw new Error("Could not analyze the question image correctly.");
    }
  });
}
