'use client';

import { useState } from 'react';
import OpenAI from 'openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  dangerouslyAllowBrowser: true
});

interface ChunkWithEmbedding {
  text: string;
  embedding: number[];
  id: string;
}

interface ProcessingStatus {
  totalChunks: number;
  processedChunks: number;
  currentBatch: number;
  totalBatches: number;
  status: string;
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [currentChunk, setCurrentChunk] = useState(0);
  const [chunks, setChunks] = useState<ChunkWithEmbedding[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChunkWithEmbedding[]>([]);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [formattedResults, setFormattedResults] = useState<string>('');

  const extractVideoId = (url: string) => {
    try {
      const urlObj = new URL(url);
      const searchParams = new URLSearchParams(urlObj.search);
      const videoId = searchParams.get('v');
      return videoId;
    } catch (e) {
      return null;
    }
  };

  const chunkText = async (text: string, chunkSize: number = 4000, overlapSize: number = 500) => {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: chunkSize,
      chunkOverlap: overlapSize,
    });

    try {
      const documents = await splitter.createDocuments([text]);
      const chunks = documents.map(doc => doc.pageContent);

      console.log('Created chunks with LangChain RecursiveCharacterTextSplitter:', {
        totalChunks: chunks.length,
        chunkSizes: chunks.map(chunk => chunk.length),
        sampleChunks: chunks.slice(0, 2).map(chunk => chunk.substring(0, 100) + '...')
      });

      return chunks;
    } catch (error) {
      console.error('Error chunking text:', error);
      throw error;
    }
  };

  const getEmbeddings = async (texts: string[]) => {
    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: texts,
        encoding_format: 'float'
      });
      return response.data.map(item => item.embedding);
    } catch (error) {
      console.error('Error getting embeddings:', error);
      throw error;
    }
  };

  const storeInPinecone = async (chunks: ChunkWithEmbedding[]) => {
    try {
      const videoId = extractVideoId(url);
      if (!videoId) throw new Error('Invalid video ID');

      const vectors = chunks.map((chunk, index) => ({
        id: `chunk-${videoId}-${index}`,
        values: chunk.embedding,
        metadata: {
          type: 'transcript',
          videoId: videoId,
          chunkIndex: index,
          timestamp: new Date().toISOString(),
          text: chunk.text,
          url: url
        }
      }));

      setProcessingStatus({
        totalChunks: vectors.length,
        processedChunks: 0,
        currentBatch: 0,
        totalBatches: Math.ceil(vectors.length / 100),
        status: 'Starting batch processing...'
      });

      const response = await fetch('/api/pinecone', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operation: 'upsert',
          data: { vectors }
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to store in Pinecone');
      }

      const result = await response.json();
      console.log('Successfully stored in Pinecone:', result.message);
      setProcessingStatus(null);
    } catch (error) {
      console.error('Error storing in Pinecone:', error);
      setProcessingStatus(null);
      throw error;
    }
  };

  const formatWithGrok = async (query: string, results: any[]) => {
    try {
      const response = await fetch('/api/grok', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userQuery: query,
          searchResults: results
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to format with Grok');
      }

      const data = await response.json();
      setFormattedResults(data.response);
    } catch (error) {
      console.error('Error formatting with Grok:', error);
      setError('Failed to format results');
    }
  };

  const searchInPinecone = async (query: string) => {
    try {
      const videoId = extractVideoId(url);
      if (!videoId) throw new Error('Invalid video ID');

      const queryEmbedding = await getEmbeddings([query]);
      console.log('Search request:', {
        query,
        videoId,
        embedding: queryEmbedding[0].slice(0, 5)
      });
      
      const response = await fetch('/api/pinecone', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operation: 'query',
          data: { 
            vector: queryEmbedding[0],
            filter: {
              videoId: videoId
            }
          }
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to search in Pinecone');
      }

      const { results } = await response.json();
      console.log('Search response:', results);
      
      const searchResults = results.matches.map((match: any) => ({
        text: match.metadata?.text as string,
        embedding: match.values,
        id: match.id,
        chunkIndex: match.metadata?.chunkIndex
      }));

      setSearchResults(searchResults);
      await formatWithGrok(query, searchResults);
    } catch (error) {
      console.error('Error searching in Pinecone:', error);
      setError('Failed to search in Pinecone');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setTranscript('');
    setChunks([]);
    setSearchResults([]);
    setFormattedResults('');

    try {
      // Extract video ID
      const videoId = extractVideoId(url);
      if (!videoId) {
        throw new Error('Invalid YouTube URL');
      }

      // Fetch transcript from Strapi
      const response = await fetch(`https://deserving-harmony-9f5ca04daf.strapiapp.com/utilai/yt-transcript/${videoId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch transcript: ${response.statusText}`);
      }
      
      const data = await response.text();
      setTranscript(data);

      // Process chunks in batches using LangChain's RecursiveCharacterTextSplitter
      const textChunks = await chunkText(data);
      const totalChunks = textChunks.length;
      const batchSize = 5;
      const totalBatches = Math.ceil(totalChunks / batchSize);

      setProcessingStatus({
        totalChunks,
        processedChunks: 0,
        currentBatch: 1,
        totalBatches,
        status: 'processing'
      });

      const chunksWithEmbeddings: ChunkWithEmbedding[] = [];

      for (let i = 0; i < totalChunks; i += batchSize) {
        const batch = textChunks.slice(i, i + batchSize);
        const embeddings = await getEmbeddings(batch);

        for (let j = 0; j < batch.length; j++) {
          chunksWithEmbeddings.push({
            text: batch[j],
            embedding: embeddings[j],
            id: `chunk-${videoId}-${i + j}`
          });
        }

        setProcessingStatus(prev => prev ? {
          ...prev,
          processedChunks: Math.min(i + batch.length, totalChunks),
          currentBatch: Math.floor((i + batch.length) / batchSize) + 1
        } : null);
      }

      setChunks(chunksWithEmbeddings);
      await storeInPinecone(chunksWithEmbeddings);

      setProcessingStatus(prev => prev ? {
        ...prev,
        status: 'completed'
      } : null);

    } catch (err: any) {
      console.error('Error:', err);
      setError(err.message || 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setIsLoading(true);
    try {
      await searchInPinecone(searchQuery);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNextChunk = () => {
    if (currentChunk < chunks.length - 1) {
      setCurrentChunk(currentChunk + 1);
    }
  };

  const handlePrevChunk = () => {
    if (currentChunk > 0) {
      setCurrentChunk(currentChunk - 1);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-gray-50">
      <main className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-gray-800">YouTube Transcript Extractor</h1>
        
        <form onSubmit={handleSubmit} className="mb-6">
          <div className="flex gap-4">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter YouTube URL"
              className="flex-1 p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            />
            <button
              type="submit"
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors duration-200"
              disabled={isLoading}
            >
              {isLoading ? 'Processing...' : 'Get Transcript'}
            </button>
          </div>
        </form>

        <form onSubmit={handleSearch} className="mb-6">
          <div className="flex gap-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in transcripts"
              className="flex-1 p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
            <button
              type="submit"
              className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors duration-200"
              disabled={isLoading}
            >
              Search
            </button>
          </div>
        </form>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {processingStatus && (
          <div className="bg-white p-6 rounded-lg shadow-md mb-6 border border-blue-100">
            <h3 className="text-lg font-semibold mb-4 text-gray-800">Processing Status</h3>
            <div className="space-y-4">
              <p className="text-gray-700">Status: <span className="font-medium">{processingStatus.status}</span></p>
              <p className="text-gray-700">Progress: <span className="font-medium">{processingStatus.processedChunks} / {processingStatus.totalChunks} chunks</span></p>
              <p className="text-gray-700">Batch: <span className="font-medium">{processingStatus.currentBatch} / {processingStatus.totalBatches}</span></p>
              <div className="w-full bg-gray-100 rounded-full h-3">
                <div 
                  className="bg-blue-600 h-3 rounded-full transition-all duration-300" 
                  style={{ width: `${(processingStatus.processedChunks / processingStatus.totalChunks) * 100}%` }}
                ></div>
              </div>
            </div>
          </div>
        )}

        {isLoading && !processingStatus && (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-blue-600 border-t-transparent"></div>
            <p className="mt-4 text-gray-600">Processing...</p>
          </div>
        )}

        {formattedResults && (
          <div className="mt-8 p-6 bg-white rounded-lg shadow-md border border-gray-200">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">Enhanced Results</h2>
            <div className="prose max-w-none text-gray-700">
              {formattedResults.split('\n').map((line, index) => {
                if (line.startsWith('# ')) {
                  return <h3 key={index} className="text-xl font-semibold mt-6 mb-3 text-gray-900">{line.substring(2)}</h3>;
                } else if (line.startsWith('## ')) {
                  return <h4 key={index} className="text-lg font-semibold mt-4 mb-2 text-gray-900">{line.substring(3)}</h4>;
                } else if (line.startsWith('- ')) {
                  return <li key={index} className="ml-4 mb-2 text-gray-700">{line.substring(2)}</li>;
                } else if (/^\d+\. /.test(line)) {
                  return <li key={index} className="ml-4 mb-2 text-gray-700 list-decimal">{line.substring(line.indexOf(' ') + 1)}</li>;
                } else if (line.trim() === '') {
                  return <br key={index} />;
                } else {
                  return <p key={index} className="mb-3 text-gray-700 leading-relaxed">{line}</p>;
                }
              })}
            </div>
          </div>
        )}

        {searchResults.length > 0 && (
          <div className="bg-white p-6 rounded-lg shadow-md mb-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">Search Results:</h2>
            {searchResults.map((result, index) => (
              <div key={result.id} className="mb-6 last:mb-0">
                <h3 className="font-semibold mb-3 text-gray-700">Result {index + 1}:</h3>
                <pre className="whitespace-pre-wrap bg-gray-50 p-4 rounded-lg border border-gray-200 text-gray-800">{result.text}</pre>
              </div>
            ))}
          </div>
        )}

        {chunks.length > 0 && (
          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">Transcript Chunk {currentChunk + 1} of {chunks.length}</h2>
              <div className="flex gap-2">
                <button
                  onClick={handlePrevChunk}
                  disabled={currentChunk === 0}
                  className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors duration-200"
                >
                  Previous
                </button>
                <button
                  onClick={handleNextChunk}
                  disabled={currentChunk === chunks.length - 1}
                  className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors duration-200"
                >
                  Next
                </button>
              </div>
            </div>
            
            <div className="mb-6">
              <h3 className="font-semibold mb-3 text-gray-700">Transcript:</h3>
              <pre className="whitespace-pre-wrap bg-gray-50 p-4 rounded-lg border border-gray-200 text-gray-800">{chunks[currentChunk].text}</pre>
            </div>

            <div>
              <h3 className="font-semibold mb-3 text-gray-700">Embedding (first 10 dimensions):</h3>
              <pre className="whitespace-pre-wrap bg-gray-50 p-4 rounded-lg border border-gray-200 overflow-x-auto text-gray-800">
                {JSON.stringify(chunks[currentChunk].embedding.slice(0, 10), null, 2)}
              </pre>
              <p className="text-sm text-gray-500 mt-2">
                Total dimensions: {chunks[currentChunk].embedding.length}
              </p>
            </div>
        </div>
        )}
      </main>
    </div>
  );
}
