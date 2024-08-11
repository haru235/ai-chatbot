import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import axios from 'axios';
import { parse } from 'node-html-parser';
import { isValidHttpUrl } from "@/app/utils";

// Initialize OpenAI and Supabase clients
const openai = new OpenAI();
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Handle POST requests
export async function POST(req) {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            try {
                // Extract data from the request
                const { text, isUrl, userName, userId } = await req.json();

                // Validate that either text or URL is provided
                if (!text) {
                    throw new Error("Either text or URL must be provided");
                }

                // Process input based on whether it's a URL or plain text
                if (isUrl) {
                    // Validate the URL format
                    if (!isValidHttpUrl(text)) {
                        throw new Error("Invalid URL provided");
                    }
                    // Process the URL input
                    await processUrlInput(text, userId, controller, encoder);
                } else {
                    // Process the text input
                    await processTextInput(text, userName, userId, controller, encoder);
                }

                // Indicate 100% completion
                controller.enqueue(encoder.encode(JSON.stringify({ percentage: 100 }) + '\n'));
            } catch (error) {
                // Handle errors by sending an error message
                console.error("Error in POST request:", error);
                controller.enqueue(encoder.encode(JSON.stringify({ error: error.message }) + '\n'));
            } finally {
                // Close the stream
                controller.close();
            }
        }
    });

    // Return a server-sent event (SSE) response
    return new NextResponse(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}

// Process input when it's a URL
async function processUrlInput(url, userId, controller, encoder) {
    console.log(`Adding context from URL: ${url}`);
    try {
        // Delete any existing documents associated with the URL and user
        await deleteExistingDocuments(url, userId);

        let documentCount = 0;
        let totalDocuments = 0;

        // First pass: count the total number of documents
        for await (const _ of generateDocumentsFromUrl(url)) {
            totalDocuments++;
        }

        // Second pass: process and embed each document
        for await (const document of generateDocumentsFromUrl(url)) {
            try {
                await processDocument(document, userId);
                documentCount++;
                // Update the client with progress
                controller.enqueue(encoder.encode(JSON.stringify({ percentage: Math.round(documentCount / totalDocuments * 100) }) + '\n'));
            } catch (docError) {
                console.log(`Error processing document ${documentCount + 1}:`, docError);
            }
        }
        console.log(`Total documents processed and embedded: ${documentCount}`);
    } catch (error) {
        console.error(`Error processing URL ${url}:`, error);
        throw error;
    }
}

// Delete existing documents associated with the given URL and user
async function deleteExistingDocuments(url, userId) {
    const { data: existingDocs, error: fetchError } = await supabase
        .from("documents")
        .select("id")
        .eq("metadata->>source", url)
        .eq("metadata->>by", userId);

    if (fetchError) throw fetchError;

    if (existingDocs.length > 0) {
        const { error: deleteError } = await supabase
            .from("documents")
            .delete()
            .in("id", existingDocs.map((doc) => doc.id));

        if (deleteError) throw deleteError;
        console.log(`Deleted old documents from ${url}`);
    }
}

// Process and embed a single document
async function processDocument(document, userId) {
    try {
        // Get the text embedding from OpenAI
        const embedding = await getEmbedding(document.content);
        // Insert the document along with its embedding into the Supabase database
        await insertDocument(document.content, embedding, { source: document.metadata.source, by: userId });
    } catch (error) {
        console.error("Error processing document:", error);
    }
}

// Insert a document with its embedding and metadata into the Supabase database
async function insertDocument(content, embedding, metadata) {
    if (content.split(" ").length < 2) return;
    const { error } = await supabase
        .from("documents")
        .insert({ content, embedding, metadata });

    if (error) throw error;
}

// Get an embedding for a given text using OpenAI
async function getEmbedding(text) {
    try {
        const response = await openai.embeddings.create({
            model: "text-embedding-ada-002",
            input: text,
        });

        if (!response.data?.[0]?.embedding) {
            throw new Error('Invalid embedding response');
        }

        return response.data[0].embedding;
    } catch (error) {
        console.error('Error getting embedding:', error);
        throw error;
    }
}

// Split text into smaller documents with a specified max size and overlap
function splitTextIntoDocuments(text, maxSize = 1000, overlap=250) {
    // Ensure overlap is less than maxSize
    overlap = Math.min(overlap, maxSize - 1);

    const sentences = text.match(/[^.!?]+[.!?]+|\S+/g) || [];
    const documents = [];
    let currentDoc = '';

    for (let i = 0; i < sentences.length; i++) {
        let sentence = sentences[i].trim();

        while (sentence.length > maxSize) {
            // If a single sentence is longer than maxSize, split it
            const chunk = sentence.slice(0, maxSize);
            const lastSpaceIndex = chunk.lastIndexOf(' ');

            if (lastSpaceIndex > 0) {
                documents.push(chunk.slice(0, lastSpaceIndex).trim());
                sentence = sentence.slice(lastSpaceIndex).trim();
            } else {
                // If there's no space, just split at maxSize
                documents.push(chunk);
                sentence = sentence.slice(maxSize).trim();
            }
        }

        // Process the (remaining) sentence
        if (currentDoc.length + sentence.length > maxSize) {
            if (currentDoc.length > 0) {
                documents.push(currentDoc.trim());

                // Create overlap
                const words = currentDoc.split(' ');
                currentDoc = '';
                let overlapSize = 0;

                while (words.length > 0 && overlapSize < overlap) {
                    const word = words.pop();
                    currentDoc = word + ' ' + currentDoc;
                    overlapSize += word.length + 1;
                }
            }
        }

        currentDoc += sentence + ' ';
    }

    // Add the last document if it's not empty
    if (currentDoc.trim().length > 0) {
        documents.push(currentDoc.trim());
    }

    return documents;
}

// Fetch HTML content from a URL, retrying if necessary
async function fetchWebContent(url, maxRetries = 3, retryDelay = 1000) {
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            const response = await axios.get(url);
            return response.data;
        } catch (error) {
            attempt++;
            console.error(`Error fetching ${url} (attempt ${attempt}):`, error.message);

            if (attempt >= maxRetries) {
                throw new Error(`Failed to fetch ${url} after ${maxRetries} attempts: ${error.message}`);
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
}

// Parse HTML content and yield text elements like headers, paragraphs, and list items
function* processHTML(html) {
    // Parse the HTML content
    const root = parse(html);

    // Extract the title of the page
    const titleElement = root.querySelector('title');
    const title = titleElement ? titleElement.text.trim() : 'No Title';
    yield { tag: 'title', text: title };

    // Query for relevant elements: headers, paragraphs, and list items
    const elements = root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li');

    // Iterate over the selected elements
    for (const element of elements) {
        // Convert the tag name to lowercase
        const tagName = element.tagName.toLowerCase();
        // Trim and clean the text content
        const text = element.text.trim().replace(/\s+/g, ' ');
        // Only yield non-empty text
        if (text) {
            yield { tag: tagName, text };
        }
    }
}

// Generate documents from a URL by splitting and organizing content
export async function* generateDocumentsFromUrl(url) {
    const html = await fetchWebContent(url);
    const processedContent = processHTML(html);

    let currentDocument = '';
    let headingStack = [];
    let isNewSection = true;

    for (const { tag, text } of processedContent) {
        if (tag === 'title') {
            // Set the title as the initial heading
            headingStack = [text];
        } else if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {

            // Yield the current document if it has content
            if (currentDocument.trim()) {
                for (const doc of splitTextIntoDocuments(currentDocument.trim())) {
                    yield {
                        content: headingStack.join(" > ") + " => " + doc,
                        metadata: { source: url },
                    };
                }
                currentDocument = '';
            }
            // Mark as a new section
            isNewSection = true;
            // Update the heading stack based on the heading level
            headingStack = headingStack.slice(0, parseInt(tag.charAt(1))).concat(text);
        }

        // Add text to the current document
        currentDocument += isNewSection ? '' : ` ${text}`;
        isNewSection = false;
    }

    // Yield any remaining content as a final document
    if (currentDocument.trim()) {
        for (const doc of splitTextIntoDocuments(currentDocument.trim())) {
            yield {
                content: headingStack.join(" > ") + " => " + doc,
                metadata: { source: url },
            };
        }
    }
}

// Process input when it's plain text
async function processTextInput(text, userName, userId, controller, encoder) {
    console.log(`Adding context from text provided by ${userName}`);
    try {
        let documentCount = 0;
        let totalDocuments = 0;

        // First pass: count the total number of documents
        for await (const _ of generateDocumentsFromText(text, userName)) {
            totalDocuments++;
        }

        // Second pass: process and embed each document
        for await (const document of generateDocumentsFromText(text, userName)) {
            try {
                await processDocument(document, userId);
                documentCount++;
                // Update the client with progress
                controller.enqueue(encoder.encode(JSON.stringify({ percentage: Math.round(documentCount / totalDocuments * 100) }) + '\n'));
            } catch (docError) {
                console.log(`Error processing document ${documentCount + 1}:`, docError);
            }
        }
        console.log(`Total documents processed and embedded: ${documentCount}`);
    } catch (error) {
        console.error("Error processing text input:", error);
        throw error;
    }
}

// Generate documents from plain text by splitting and organizing content
export async function* generateDocumentsFromText(text, userName) {
    let currentDocument = '';
    const lines = text.split('\n');

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine) {
            // Start a new document if the current one is too long
            if (currentDocument.length + trimmedLine.length > 2000) {
                for (const doc of splitTextIntoDocuments(currentDocument)) {
                    yield {
                        content: doc,
                        metadata: { source: userName },
                    };
                }
                currentDocument = '';
            }
            currentDocument += `${trimmedLine}\n`;
        }
    }

    // Yield any remaining content as a final document
    if (currentDocument.trim()) {
        for (const doc of splitTextIntoDocuments(currentDocument.trim())) {
            yield {
                content: doc,
                metadata: { source: userName },
            };
        }
    }
}