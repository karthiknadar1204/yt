import OpenAI from "openai";
import { NextResponse } from 'next/server';

const client = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: "https://api.x.ai/v1",
});

export async function POST(request: Request) {
  try {
    const { userQuery, searchResults } = await request.json();

    const systemPrompt = `You are a helpful assistant that formats and enhances search results from a vector database. 
    The user has searched for: "${userQuery}"
    
    You will receive search results from the database. Your task is to analyze and format these results in the following structure:

    # Summary
    [Provide a 2-3 sentence overview of what was found]

    # Key Findings
    1. [First key point or insight]
    2. [Second key point or insight]
    3. [Third key point or insight]

    # Detailed Analysis
    [For each relevant chunk of text:]
    - Context: [Brief context of where this appears]
    - Content: [The relevant text or information]
    - Significance: [Why this is important to the query]

    # Connections
    [Describe how different pieces of information relate to each other and to the user's query]

    # Additional Context
    [Any relevant background information or related concepts that help understand the results]

    Guidelines:
    1. Be concise but informative
    2. Maintain the original meaning
    3. Use bullet points and numbered lists for clarity
    4. Highlight direct quotes when relevant
    5. Explain technical terms if needed
    6. Focus on the most relevant information first

    Format the response in markdown for better readability.`;

    const completion = await client.chat.completions.create({
      model: "grok-3-mini-fast",
      messages: [
        { role: "system", content: systemPrompt },
        { 
          role: "user", 
          content: `Here are the search results from the vector database:\n${JSON.stringify(searchResults, null, 2)}\n\nPlease format and enhance these results based on the user's query: "${userQuery}"` 
        }
      ],
      temperature: 0.7,
      max_tokens: 1000
    });

    return NextResponse.json({ 
      response: completion.choices[0].message.content 
    });
  } catch (error) {
    console.error('Error calling Grok API:', error);
    return NextResponse.json(
      { error: 'Failed to process with Grok' },
      { status: 500 }
    );
  }
} 