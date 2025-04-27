import { Pinecone } from '@pinecone-database/pinecone';
import { NextResponse } from 'next/server';

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || '',
});

const BATCH_SIZE = 100; // Number of vectors to process in each batch

export async function POST(request: Request) {
  try {
    const { operation, data } = await request.json();

    switch (operation) {
      case 'upsert':
        const index = pinecone.index('yt');
        const vectors = data.vectors;
        
        // Process vectors in batches
        for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
          const batch = vectors.slice(i, i + BATCH_SIZE);
          await index.upsert(batch);
          console.log(`Processed batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(vectors.length / BATCH_SIZE)}`);
        }
        
        return NextResponse.json({ success: true, message: `Processed ${vectors.length} vectors in ${Math.ceil(vectors.length / BATCH_SIZE)} batches` });

      case 'query':
        const queryIndex = pinecone.index('yt');
        const { vector, filter } = data;
        console.log('Query request data:', { vector: vector.slice(0, 5), filter });
        
        const results = await queryIndex.query({
          vector,
          topK: 5,
          includeMetadata: true,
          filter: filter || undefined
        });
        
        console.log('Query results:', {
          matches: results.matches.map(match => ({
            id: match.id,
            score: match.score,
            metadata: match.metadata
          }))
        });
        
        return NextResponse.json({ results });

      default:
        return NextResponse.json({ error: 'Invalid operation' }, { status: 400 });
    }
  } catch (error) {
    console.error('Pinecone operation failed:', error);
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
  }
} 