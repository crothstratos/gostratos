import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import { PDFParse } from "pdf-parse";
import { parseOffice } from "officeparser";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import http from "http";

// Initialize Firebase Admin if credentials are provided
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
    console.log("Firebase Admin initialized successfully.");
  } else if (process.env.GOOGLE_CLOUD_PROJECT) {
    // Running on App Engine / Cloud Run: use Application Default Credentials,
    // i.e. the platform's own service account. No key file needed.
    initializeApp();
    console.log("Firebase Admin initialized with Application Default Credentials.");
  } else {
    console.warn(
      "FIREBASE_SERVICE_ACCOUNT not set and no ADC available. Webhooks requiring admin access will fail.",
    );
  }
} catch (error) {
  console.error("Failed to initialize Firebase Admin:", error);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000; // Cloud Run injects PORT

  // API routes FIRST
  app.use(express.json({ limit: "100mb" }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // ---- Authentication gate for every /api route defined below ----
  // Verifies the caller's Firebase ID token and applies the same access
  // policy as firestore.rules. /api/health is defined above this line and
  // stays public so App Engine can health-check the service.
  const ALLOWED_DOMAIN = "gostratos.vc";
  const REVOKED_EMAILS = new Set([
    "dwhite@gostratos.vc",
    "cjrothai@gmail.com",
    "joe@highwayventures.com",
  ]);

  app.use("/api", async (req, res, next) => {
    if (!getApps().length) {
      if (process.env.NODE_ENV === "production") {
        console.error("Firebase Admin is not initialised — refusing API requests.");
        return res.status(503).json({ error: "Server authentication is not configured." });
      }
      console.warn("Firebase Admin not initialised — skipping API auth (development only).");
      return next();
    }

    try {
      const header = req.headers.authorization || "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      if (!token) {
        return res.status(401).json({ error: "Not signed in." });
      }

      const decoded = await getAuth().verifyIdToken(token);
      const email = (decoded.email || "").toLowerCase();
      const allowed =
        decoded.email_verified === true &&
        email.endsWith("@" + ALLOWED_DOMAIN) &&
        !REVOKED_EMAILS.has(email);

      if (!allowed) {
        console.warn(`Rejected API call from unauthorized account: ${email || "unknown"}`);
        return res.status(403).json({ error: "This account is not authorized to use the Stratos VP CRM." });
      }

      (req as any).user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
  });

  const getGeminiAI = () => {
    let apiKey = (
      process.env.API_KEY ||
      process.env.GEMINI_API_KEY ||
      ""
    ).trim();
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
      throw new Error(
        "API key is missing or invalid. The server's Gemini API key is not configured. Contact your administrator."
      );
    }
    return new GoogleGenAI({ apiKey });
  };

  app.post("/api/scan-website", async (req, res) => {
    try {
      const { url } = req.body;
      const ai = getGeminiAI();

      const prompt = `
You are an expert VC analyst. I am providing you with a website URL of a venture capital firm: ${url}.
Using your search capabilities and knowledge base, please identify:
1. A comprehensive list of their portfolio companies (as an array of strings). Please try to find and list as many of their portfolio companies as possible using search.
2. The primary location or headquarters of the firm (as a string).

Return the information strictly as a JSON object matching this schema:
{
  "companies": ["Company 1", "Company 2"],
  "location": "City, State/Country"
}
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              companies: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of portfolio companies",
              },
              location: {
                type: Type.STRING,
                description: "Primary location of the firm",
              },
            },
          },
          tools: [{ googleSearch: {} }],
        },
      });

      let text = response.text || "{}";
      text = text
        .replace(/^```(json)?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch (err) {
        console.error("JSON parsing error. Raw response:", text);
        throw err;
      }
      res.json(data);
    } catch (error) {
      console.error("Error scanning website:", error);
      res.status(500).json({ error: "Failed to scan website" });
    }
  });

  app.post("/api/discover-coinvestors", async (req, res) => {
    try {
      const { companyName, companyDescription, vertical } = req.body;
      const ai = getGeminiAI();

      const prompt = `
You are an expert VC analyst. I am providing you with details of a startup:
Name: ${companyName}
Description: ${companyDescription}
Vertical: ${vertical}

Using your knowledge base and search, suggest 3-5 real Venture Capital firms that are highly likely to invest in this type of company (based on their actual historical investments in this vertical or stage).

Return the information strictly as a JSON object matching this schema:
{
  "investors": [
    {
      "name": "Firm Name",
      "rationale": "Why they are a good fit",
      "similarInvestments": ["Company A", "Company B"]
    }
  ]
}
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              investors: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    rationale: { type: Type.STRING },
                    similarInvestments: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                },
              },
            },
          },
          tools: [{ googleSearch: {} }],
        },
      });

      let text = response.text || "{}";
      text = text
        .replace(/^```(json)?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch (err) {
        console.error("JSON parsing error. Raw response:", text);
        throw err;
      }
      res.json(data);
    } catch (error) {
      console.error("Error discovering coinvestors:", error);
      res.status(500).json({ error: "Failed to discover coinvestors" });
    }
  });

  app.post("/api/extract", async (req, res) => {
    try {
      const { notes, type, input } = req.body;
      const ai = getGeminiAI();

      const prompt = `
You are an expert VC analyst. Analyze the following startup data provided.
Extract the following information and return it strictly as a JSON object matching this schema (use null if not found):
{
  "name": "Startup Name",
  "website": "Domain",
  "location": "City, State",
  "vertical": "Vertical category",
  "slogan": "Company Slogan",
  "basics": "One paragraph summary",
  "founderName": "Founders",
  "founderEmail": "Emails",
  "revenue": "Revenue stats",
  "dealTerms": "Deal terms",
  "pastFinancing": "Past rounds",
  "marketProblem": "Problem statement",
  "companySolution": "Solution statement",
  "competition": "Competition",
  "pricing": "Pricing",
  "gtm": "Go-To-Market (GTM)",
  "source": "Internal Source",
  "externalSource": "External Source",
  "takeaways": "Key takeaways or meeting notes for the interaction",
  "nextSteps": "Actionable next steps"
}
`;

      let contentConfig;

      if (type === "deck" && input) {
        const match = input.match(/^data:(.*?);base64,(.*)$/);
        if (match) {
          const mimeType = match[1];
          const base64Str = match[2];
          contentConfig = {
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: base64Str } },
            ],
          };
        } else {
          contentConfig = prompt + "\n\nData:\n" + input;
        }
      } else if (notes) {
        contentConfig = prompt + "\n\nData:\n" + notes;
      } else {
        return res.status(400).json({ error: "No input provided" });
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: contentConfig,
        config: {
          responseMimeType: "application/json",
        },
      });

      let result = {};
      try {
        let text = response.text || "{}";
        text = text
          .replace(/^```(json)?\s*/i, "")
          .replace(/```\s*$/, "")
          .trim();
        result = JSON.parse(text);
      } catch (e) {
        console.error("JSON parsing error in /api/extract", e);
      }
      res.json(result);
    } catch (err) {
      console.error("Extract Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/describe", async (req, res) => {
    try {
      const { name, website } = req.body;
      const ai = getGeminiAI();

      const prompt = `
You are an expert venture capital analyst.
Write a concise, professional, 1-2 paragraph description of the company "${name}" (${website}).
Focus on what they do, their market, and their core product/service. Do not use filler text.
Output ONLY the raw description text.
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
      });

      res.json({ description: response.text });
    } catch (err) {
      console.error("Describe Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/analyze", async (req, res) => {
    try {
      const { input, type } = req.body;
      const ai = getGeminiAI();

      const prompt = `
You are an expert VC analyst. Analyze the following startup data provided as type "${type}":
${input}

Extract the following information and return it strictly as a JSON object matching this schema (use null if not found):
{
  "name": "Startup Name",
  "website": "Domain",
  "location": "City, State",
  "vertical": "Vertical category",
  "basics": "One paragraph summary",
  "founderName": "Founders",
  "founderEmail": "Emails",
  "revenue": "Revenue stats",
  "dealTerms": "Deal terms",
  "pastFinancing": "Past rounds",
  "marketProblem": "Problem statement",
  "companySolution": "Solution statement"
}
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      let result = {};
      try {
        let text = response.text || "{}";
        text = text
          .replace(/^```(json)?\s*/i, "")
          .replace(/```\s*$/, "")
          .trim();
        result = JSON.parse(text);
      } catch (e) {
        console.error("JSON parsing error in /api/analyze", e);
      }
      res.json(result);
    } catch (err) {
      console.error("Analyze Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/analyze-email", async (req, res) => {
    try {
      const { emailContent, investorType } = req.body;
      const ai = getGeminiAI();
      const prompt = `Analyze this VC email (${investorType}):\n${emailContent}\nExtract an array of tasks or next steps based on the context. Return JSON: { "tasks": ["task 1", "task 2"] }`;
      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });
      res.json(JSON.parse(response.text || '{"tasks": []}'));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/search-chat", async (req, res) => {
    try {
      const { query, localCompanies = [] } = req.body;
      const ai = getGeminiAI();
      const finalPrompt = `
You are an expert Venture Capital Analyst and Data Assistant for a Venture Capital firm.
Your job is to help the VC team evaluate, source, and learn more about startups in our internal database.
The user (a VC associate or partner) asked: "${query}"

Here is the local CRM Web App Data from the active session (companies currently tracked on the kanban boards):
${
  localCompanies.length > 0
    ? JSON.stringify(
        localCompanies.map((c) => ({
          name: c.name,
          stage: c.stage,
          vertical: c.vertical,
          location: c.location,
          fund: c.fund,
          basics: c.basics,
        })),
        null,
        2
      )
    : "No local CRM companies available or none tracked."
}

Instructions:
1. Act as a trusted VC analyst. Answer the user's question clearly, concisely, and professionally using ONLY the provided data.
2. Format your response beautifully in Markdown:
   - Start with a direct, insightful summary (the "TL;DR").
   - Use Markdown tables to cleanly display lists of companies or comparisons.
   - Use bullet points for key takeaways, strengths, or observations.
   - Bold key metrics (e.g., **Revenue**, **Raise Size**, **Location**).
3. STRICT DATA POLICY: If the data to answer the user's question is missing, incomplete, or the result set is empty:
   - CLEARLY state that you do not have that information in the current database.
   - Do NOT invent, hallucinate, or guess data.
   - Do NOT complain about JSON schemas or SQL queries. Just state the facts.
4. Provide analytical depth (e.g., identifying market trends, comparing burn rates, or noting funding stage patterns) if the data supports it, rather than just regurgitating rows.
      `;

      const finalResponse = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: finalPrompt,
      });

      res.json({ response: finalResponse.text });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The Gmail OAuth routes, the email-sync endpoints and the 15-minute
  // background sync job were removed during the Firebase migration. Their
  // front-end buttons had already been stripped out by an AI Studio script,
  // so they were unreachable code left exposed on a public endpoint.
  // The live Gmail/Calendar features call Google's APIs directly from the
  // browser using the token from Google sign-in.

  app.post("/api/summarize-conversations", async (req, res) => {
    try {
      const { emails } = req.body;
      if (!Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ error: "No emails provided to summarize." });
      }

      const ai = getGeminiAI();
      const transcript = emails
        .map(
          (e) =>
            `Date: ${e.date}\nFrom: ${e.from}\nTo: ${e.to}\nSubject: ${e.subject}\n${e.body || e.snippet || ""}`
        )
        .join("\n\n---\n\n");

      const prompt = `You are an analyst at a venture capital firm. Below is an email thread between the firm and a founder.

Summarize the current state of the relationship in one short paragraph, then list the concrete next steps the firm should take. Be specific and factual. Do not invent commitments that were not actually made.

Return JSON strictly matching this shape:
{ "summary": "one paragraph", "nextSteps": ["step 1", "step 2"] }

Emails:
${transcript}`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });

      const parsed = JSON.parse(response.text || '{"summary":"","nextSteps":[]}');
      res.json({
        summary: parsed.summary || "",
        nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // NOTE: the /api/config route was removed during the Firebase migration.
  // It returned the Gemini API key to any unauthenticated caller and
  // nothing in src/ ever called it. Gemini access stays server-side only.

  const server = http.createServer(app);

  let vite;
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is in use, retrying...`);
      setTimeout(() => {
        server.close();
        server.listen(PORT, "0.0.0.0");
      }, 1000);
    } else {
      console.error("Server error:", e);
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down server...");
    setTimeout(() => {
      console.log("Forcing exit after timeout");
      process.exit(0);
    }, 1000);

    if (vite) {
      try {
        await vite.close();
      } catch (e) {
        console.error("Error closing Vite:", e);
      }
    }
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

startServer();
