# YT Chat: Chat with Your YouTube Videos

> **Note:** This project is still a work in progress. I built it during the duration of my finals, so there's a fair amount of ad-hoc code. I’m currently working on splitting the codebase into more modular components and fine-tuning the application for better performance and usability. **Contributions and feedback are welcome!**

**YT Chat** is a Next.js TypeScript application that allows users to interact with YouTube videos through a conversational interface. Powered by **Pinecone** for vector storage, **Grok LLM (via xAI)** for conversational AI, and **OpenAI embeddings** for semantic understanding, this app enables users to ask questions about video content and receive meaningful responses.

---

## ✨ Features

- **YouTube Video Integration**: Upload or link a YouTube video to start chatting.
- **Semantic Search**: Uses OpenAI embeddings to understand video content and Pinecone for efficient vector storage and retrieval.
- **Conversational AI**: Powered by Grok LLM for natural, context-aware responses.
- **Next.js Frontend**: A modern, responsive UI built with TypeScript and Next.js for seamless user experience.
- **Scalable Architecture**: Designed to handle large-scale video data with Pinecone’s vector database.

---

## 🧰 Tech Stack

- **Frontend**: Next.js, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **Vector Database**: Pinecone
- **LLM**: Grok (xAI)
- **Embeddings**: OpenAI
- **Fonts**: Geist (optimized with `next/font`)

---

## 🚀 Getting Started

### ✅ Prerequisites

- [Node.js](https://nodejs.org/) (>= 18.x)
- A package manager: `npm`, `yarn`, `pnpm`, or `bun`
- API accounts with:
  - [Pinecone](https://www.pinecone.io/)
  - [xAI](https://x.ai/)
  - [OpenAI](https://openai.com/)

---

### 📦 Installation

Clone the repository:

```bash
git clone https://github.com/your-username/yt-chat.git
cd yt-chat
```

```bash
npm install --legacy-peer-deps
```

```bash
PINECONE_API_KEY=your-pinecone-api-key
XAI_API_KEY=your-xai-api-key
OPENAI_API_KEY=your-openai-api-key
```
```bash
npm run dev
```
