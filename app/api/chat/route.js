import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

// Initialize OpenAI client with API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize Supabase client with URL and service role key from environment variables
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// POST request handler function
export async function POST(req) {
  // Encoder to encode response data
  const encoder = new TextEncoder();

  // Create a readable stream to handle the response
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Parse JSON body of the request to extract messages and query
        const { messages, query, useOnlyMyContext, userId, language } = await req.json();
        console.log("Received request:", { messages, query, useOnlyMyContext, userId, language });

        // Call Supabase RPC function to match documents based on the query embedding
        const { data: documents, error } = await supabase.rpc("match_documents", {
          query_embedding: await getEmbedding(query), // Get embedding for the query text
          match_threshold: 0.78, // Threshold for document matching
          match_count: 5, // Number of documents to return
          user_id: useOnlyMyContext ? userId : null,
        });

        // Handle errors during document retrieval
        if (error) {
          throw new Error("Failed to retrieve relevant documents");
        }

        console.log(`${documents.length} contexts found!`);

        // Send matched documents as context to the client
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'context', documents }) + '\n'));

        // Combine the contents of all matched documents into a single context string
        const context = documents.map(doc => doc.content).join("\n\n");
        // Create a system prompt incorporating the context for the AI to generate a response
        const systemPrompt = `Context: ${context}\nAnswer based on this context\n If no context, answer using general knowledge.Always respond in ${language}, translating response if necessary.`;

        // Generate a streaming completion using OpenAI's API
        const completionStream = await openai.chat.completions.create({
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          model: "gpt-4o-mini", // Specify the model to use for the completion
          stream: true, // Enable streaming for the response
        });

        // Stream the response content back to the client as it is generated
        for await (const chunk of completionStream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'content', content }) + '\n'));
          }
        }
      } catch (error) {
        // Handle errors in the POST request and log them
        console.error('Error in POST request:', error);
        controller.enqueue(encoder.encode(JSON.stringify({ error: error.message }) + '\n'));
      } finally {
        // Close the stream once the process is complete
        controller.close();
      }
    },
  });

  // Return the stream as the response with appropriate headers for server-sent events
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// Helper function to get the embedding of a text using OpenAI's API
async function getEmbedding(text) {
  try {
    // Request the embedding from OpenAI
    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002", // Specify the embedding model to use
      input: text, // Input text to be embedded
    });

    // Check for a valid embedding response
    if (!response.data?.[0]?.embedding) {
      throw new Error('Invalid embedding response');
    }

    // Return the embedding vector
    return response.data[0].embedding;
  } catch (error) {
    // Handle and log errors in the embedding process
    console.error('Error getting embedding:', error);
    throw error;
  }
}