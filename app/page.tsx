'use client';

import { useState, useRef, useEffect } from 'react';
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

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
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
  const [messages, setMessages] = useState<Message[]>([]);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

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
      
      // Add AI response to history immediately after receiving it
      const aiMessage: Message = {
        role: 'assistant',
        content: data.response,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error('Error formatting with Grok:', error);
      setError('Failed to format results');
      
      // Add error message to chat
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Sorry, I encountered an error while processing your request.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
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
      // Add user message to history
      const userMessage: Message = {
        role: 'user',
        content: searchQuery,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, userMessage]);
      
      await searchInPinecone(searchQuery);
      // Note: We no longer need to add AI message here as it's handled in formatWithGrok
    } finally {
      setIsLoading(false);
      setSearchQuery('');
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
      <main className="max-w-7xl mx-auto">
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

        {transcript && (
          <div className="space-y-8">
            {/* Video Section */}
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h2 className="text-xl font-semibold mb-4 text-gray-800">Video</h2>
              <div className="aspect-w-16 aspect-h-9 max-w-4xl mx-auto">
                <iframe
                  src={`https://www.youtube.com/embed/${extractVideoId(url)}`}
                  title="YouTube video player"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full rounded-lg"
                ></iframe>
              </div>
            </div>

            {/* Chat Panel */}
            <div className="bg-white p-6 rounded-lg shadow-md max-w-4xl mx-auto">
              <h2 className="text-xl font-semibold mb-4 text-gray-800">Chat Panel</h2>
              
              {/* Messages Container */}
              <div 
                ref={chatContainerRef}
                className="mb-6 h-[400px] overflow-y-auto p-4 space-y-4 bg-gray-50 rounded-lg"
              >
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg p-4 ${
                        message.role === 'user'
                          ? 'bg-blue-600 text-white ml-4'
                          : 'bg-white text-gray-800 mr-4 shadow-sm'
                      }`}
                    >
                      <div className="prose max-w-none">
                        {message.content.split('\n').map((line, lineIndex) => {
                          if (line.startsWith('# ')) {
                            return <h3 key={lineIndex} className={`text-xl font-semibold mt-6 mb-3 ${message.role === 'user' ? 'text-white' : 'text-gray-900'}`}>{line.substring(2)}</h3>;
                          } else if (line.startsWith('## ')) {
                            return <h4 key={lineIndex} className={`text-lg font-semibold mt-4 mb-2 ${message.role === 'user' ? 'text-white' : 'text-gray-900'}`}>{line.substring(3)}</h4>;
                          } else if (line.startsWith('- ')) {
                            return <li key={lineIndex} className={`ml-4 mb-2 ${message.role === 'user' ? 'text-white' : 'text-gray-700'}`}>{line.substring(2)}</li>;
                          } else if (/^\d+\. /.test(line)) {
                            return <li key={lineIndex} className={`ml-4 mb-2 list-decimal ${message.role === 'user' ? 'text-white' : 'text-gray-700'}`}>{line.substring(line.indexOf(' ') + 1)}</li>;
                          } else if (line.trim() === '') {
                            return <br key={lineIndex} />;
                          } else {
                            return <p key={lineIndex} className={`mb-3 leading-relaxed ${message.role === 'user' ? 'text-white' : 'text-gray-700'}`}>{line}</p>;
                          }
                        })}
                      </div>
                      <div className={`text-xs mt-2 ${message.role === 'user' ? 'text-blue-100' : 'text-gray-500'}`}>
                        {message.timestamp.toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white text-gray-800 rounded-lg p-4 shadow-sm">
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <form onSubmit={handleSearch} className="mb-6">
                <div className="flex gap-4">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Ask a question about the video..."
                    className="flex-1 p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                  <button
                    type="submit"
                    className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors duration-200"
                    disabled={isLoading}
                  >
                    Ask
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

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
      </main>
    </div>
  );
}
