# File Uploader (ZIP Analyzer)

## 1. Project Overview
This project is built to handle the challenge of uploading very large files (greater than 1GB or more) without crashing the server or losing progress. I used React for the frontend, Node.js for the backend, and MySQL to keep track of every single piece of data.

## 2. How I Solved the Requirements

### A. Smart Chunking & Concurrency
The Problem:  
Browsers often fail when trying to upload a single > 1GB file because the connection is too long or the file is too big.

My Solution:  
I used the Blob.slice() API in the frontend to split the file into 5MB chunks.

Control:  
I limited the system to 3 concurrent uploads. This means the browser only sends 3 chunks at a time, which keeps the network stable and doesn't freeze the user's computer.

### B. Resumability (Pause & Resume)
Handshake:  
Before starting an upload, the frontend handshakes with the backend by sending a unique hash of the file.

The Brain:  
The backend checks the MySQL database to see if parts of the file were already uploaded.

Result:  
If the page is refreshed or the internet connection is lost, the user can select the same file again. The UI resumes exactly where it left off and uploads only the missing chunks.

### C. Backend Resilience & Memory Efficiency
Streaming I/O:  
The backend never loads the entire file into memory. It streams each 5MB chunk directly to disk using byte offsets.

Integrity:  
After all chunks are uploaded, the server computes a SHA-256 hash of the final file to ensure no data corruption occurred.

Peeking:  
The yauzl library is used to inspect the contents of the ZIP file without extracting it fully.

## 3. Handling Bonus Cases
Double-Finalize:  
MySQL GET_LOCK is used to ensure that even if two finalize requests occur simultaneously, the server processes the file only once.

Network Flapping:  
A retry mechanism with Exponential Backoff retries failed chunk uploads up to 3 times before stopping.

Out-of-Order Delivery:  
Chunks can arrive in any order. Since they are written using byte offsets, the file is reconstructed correctly.

## 4. How to Run This Project

### Using Docker (Recommended)
Install Docker Desktop.  
Open a terminal in the project root directory.  
Run:
docker-compose up --build  
Open http://localhost:3000 in your browser.

## OR

### Manual Setup
Database:  
Create a MySQL database named chunked_uploads and run the required queries given below :

CREATE DATABASE chunked_uploads;
USE chunked_uploads;

```
CREATE TABLE uploads (
    id VARCHAR(255) PRIMARY KEY, -- This will store the fileHash
    filename VARCHAR(255) NOT NULL,
    total_size BIGINT NOT NULL,
    total_chunks INT NOT NULL,
    status ENUM('UPLOADING', 'PROCESSING', 'COMPLETED', 'FAILED') DEFAULT 'UPLOADING',
    final_hash VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chunks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    upload_id VARCHAR(255),
    chunk_index INT NOT NULL,
    status ENUM('PENDING', 'UPLOADED') DEFAULT 'PENDING',
    received_at TIMESTAMP NULL,
    FOREIGN KEY (upload_id) REFERENCES uploads(id)
);

SELECT * FROM uploads;
SELECT * from chunks;
SELECT * FROM chunks WHERE status = 'UPLOADED';
```

Backend:  
Go to the backend folder, run npm install, then node server.js.

Frontend:  
Go to the frontend folder, run npm install, then npm start.

## 5. Technical Trade-offs & Future Improvements
Current Hash:  
The handshake hash is based on file name, size, and date for performance. In production, a partial content hash would improve security.

Future Enhancement:  
A manual Pause button could be added, although automatic resume already handles refreshes and connection drops effectively.
