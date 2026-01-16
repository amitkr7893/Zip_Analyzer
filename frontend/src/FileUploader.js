import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import './fileUploader.css';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_CONCURRENT = 3; // Concurrency limit 
const MAX_RETRIES = 3;
const API_URL = 'http://localhost:5000';

export default function FileUploader() {
  const [file, setFile] = useState(null);
  const [uploadId, setUploadId] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [eta, setEta] = useState(0);
  const [message, setMessage] = useState('');
  
  const activeUploads = useRef(0);
  const startTime = useRef(null);
  const uploadedBytes = useRef(0);

  const calculateFileHash = (file) => `${file.name}-${file.size}-${file.lastModified}`;

  const handleFileSelect = async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;
    setFile(selectedFile);
    setMessage('Checking for existing upload...');

    const hash = calculateFileHash(selectedFile);
    try {
      // Handshake to support resumability [cite: 17, 18]
      const res = await axios.post(`${API_URL}/handshake`, {
        fileHash: hash,
        filename: selectedFile.name,
        totalSize: selectedFile.size,
        totalChunks: Math.ceil(selectedFile.size / CHUNK_SIZE)
      });

      const { uploadId: id, uploadedChunks } = res.data;
      setUploadId(id);
      const total = Math.ceil(selectedFile.size / CHUNK_SIZE);
      
      const chunkArray = Array.from({ length: total }, (_, i) => ({
        index: i,
        status: uploadedChunks.includes(i) ? 'success' : 'pending'
      }));

      setChunks(chunkArray);
      
      // Fixed: Correctly update progress state on selection [cite: 22]
      const initialProgress = (uploadedChunks.length / total) * 100;
      setProgress(initialProgress);
      uploadedBytes.current = uploadedChunks.length * CHUNK_SIZE;

      setMessage(uploadedChunks.length > 0 ? `Found existing upload. ${uploadedChunks.length}/${total} chunks ready.` : 'Ready to upload.');
    } catch (err) {
      setMessage('Handshake failed. Check server connection.');
    }
  };

// Helper function to handle the delay outside of the loop scope
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const uploadChunk = async (index) => {
  const start = index * CHUNK_SIZE;
  const end = Math.min(start + CHUNK_SIZE, file.size);
  const blob = file.slice(start, end); // Chunking: Use Blob.slice() [cite: 15]

  const formData = new FormData();
  formData.append('chunk', blob);
  formData.append('uploadId', uploadId);
  formData.append('chunkIndex', index);

  let attempt = 0;
  let success = false;

  while (attempt < MAX_RETRIES && !success) {
    try {
      updateChunkStatus(index, 'uploading');
      await axios.post(`${API_URL}/upload-chunk`, formData);
      
      updateChunkStatus(index, 'success');
      uploadedBytes.current += blob.size;
      success = true; // Exit the loop on success
    } catch (error) {
      attempt++;
      if (attempt < MAX_RETRIES) {
        // Updated: Using the helper function to avoid no-loop-func warning
        const backoffDelay = Math.pow(2, attempt) * 1000; // Exponential backoff 
        updateChunkStatus(index, 'retrying');
        await sleep(backoffDelay); 
      } else {
        updateChunkStatus(index, 'error'); // Final error state [cite: 23]
        return false;
      }
    }
  }
  return success;
};

  const updateChunkStatus = (index, status) => {
    setChunks(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], status };
      return updated;
    });
  };

  const startUpload = async () => {
    if (!file || !uploadId) return;
    setUploading(true);
    startTime.current = Date.now();
    setMessage('Uploading...');
    
    const pending = chunks.filter(c => c.status !== 'success');
    
    const promises = [];
    for (const chunk of pending) {
      // Concurrent upload management 
      while (activeUploads.current >= MAX_CONCURRENT) {
        await new Promise(r => setTimeout(r, 100));
      }
      activeUploads.current++;
      const p = uploadChunk(chunk.index).finally(() => activeUploads.current--);
      promises.push(p);
    }

    await Promise.all(promises);

    const allDone = chunks.every(c => c.status === 'success');
    if (allDone) {
      setMessage('Finalizing and calculating checksum...');
      try {
        // High timeout for large file hashing [cite: 11]
        const res = await axios.post(`${API_URL}/finalize`, { uploadId }, { timeout: 600000 });
        setMessage(`Success! SHA-256: ${res.data.hash.slice(0, 16)}...`);
        setProgress(100);
      } catch (e) {
        setMessage('Finalization error. The file may still be processing on the server.');
      }
    }
    setUploading(false);
  };

  useEffect(() => {
    if (!uploading) return;
    const inv = setInterval(() => {
      const successCount = chunks.filter(c => c.status === 'success').length;
      setProgress((successCount / chunks.length) * 100);

      // Live Metrics: MB/s and ETA [cite: 24]
      if (startTime.current && uploadedBytes.current > 0) {
        const elapsed = (Date.now() - startTime.current) / 1000;
        const mbps = (uploadedBytes.current / (1024 * 1024)) / elapsed;
        setSpeed(mbps);
        const remaining = file.size - uploadedBytes.current;
        setEta(remaining / (mbps * 1024 * 1024));
      }
    }, 300);
    return () => clearInterval(inv);
  }, [uploading, chunks, file, eta]);

  return (
    <div className="container">
      <h2 className="title">ZIP Uploader</h2>
      
      <input type="file" onChange={handleFileSelect} disabled={uploading} style={{marginBottom: '20px'}} />
      
      {file && (
        <>
          <div className="file-info">
            <p><strong>File:</strong> {file.name}</p>
            <p><strong>Size:</strong> {(file.size / (1024*1024)).toFixed(2)} MB</p>
            <p><strong>Total Chunks:</strong> {chunks.length}</p>
          </div>

          <div className="progress-wrapper">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }}></div>
            </div>
            <div className="metrics">
              <span>{progress.toFixed(1)}% Complete</span>
              {uploading && <span>{speed.toFixed(2)} MB/s | ETA: {eta.toFixed(0)}s</span>}
            </div>
          </div>

          <p style={{fontSize: '14px', fontWeight: '600'}}>Status Grid of Chunks Upload</p>
          <div className="grid">
            {chunks.map((c, i) => (
              <div key={i} className={`chunk ${c.status}`} title={`Chunk ${i}: ${c.status}`}></div>
            ))}
          </div>

          <button onClick={startUpload} disabled={uploading || progress === 100} className="btn">
            {uploading ? 'Processing...' : 'Start Upload'}
          </button>
        </>
      )}

      {message && <div className="msg">{message}</div>}
    </div>
  );
}