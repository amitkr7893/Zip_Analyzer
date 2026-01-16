#File Uploader (ZIP Analyzer)

1. Project Overview
This project is built to handle the challenge of uploading very large files (up to 8GB or more) without crashing the server or losing progress. I used React for the frontend, Node.js for the backend, and MySQL to keep track of every single piece of data.
+1

2. How I Solved the Requirements
A. Smart Chunking & Concurrency

The Problem: Browsers often fail when trying to upload a single 8GB file because the connection is too long or the file is too big.


My Solution: I used the Blob.slice() API in the frontend to split the file into 5MB chunks.


Control: I limited the system to 3 concurrent uploads. This means the browser only sends 3 chunks at a time, which keeps the network stable and doesn't freeze the user's computer.
+1

B. Resumability (Pause & Resume)

Handshake: Before starting an upload, the frontend "handshakes" with the backend. It sends a unique hash of the file.
+2


The "Brain": The backend checks the MySQL database to see if we have already uploaded some parts of this file.
+1

Result: If you refresh the page or lose your internet, you can just select the same file again. The UI will show exactly where it left off (e.g., 73% or 95%) and only upload the missing parts.

C. Backend Resilience & Memory Efficiency

Streaming I/O: I made sure the backend never loads the whole 8GB file into RAM. Instead, it uses Streams to write each 5MB chunk directly to the correct spot in the file using byte offsets.
+2


Integrity: Once the last chunk is in, the server calculates a SHA-256 hash of the final file to make sure no data was lost or corrupted during the move.
+1


Peeking: I used the yauzl library to look inside the ZIP file and list the top-level files without having to extract the whole thing to the disk.

3. Handling Bonus Cases

Double-Finalize: I used MySQL GET_LOCK to ensure that even if two "finish" requests come at once, the server only processes the final file once.


Network Flapping: I implemented a retry system with Exponential Backoff. If a chunk fails (like a 500 error), it waits a bit and tries again up to 3 times before giving up.
+2

Out-of-Order Delivery: Since I write to specific positions in the file, it doesn't matter if Chunk #100 arrives before Chunk #1. The file will still be built correctly.

4. How to Run This Project
Using Docker (Recommended)
This is the easiest way to see everything working together:

Make sure you have Docker Desktop installed.

Open your terminal in the project root folder.

Run:

Bash
docker-compose up --build
Open http://localhost:3000 in your browser.

Manual Setup
Database: Create a MySQL database named chunked_uploads and run the queries provided in the server.js comments.

Backend: Go to the backend/ folder, run npm install, then node server.js.

Frontend: Go to the frontend/ folder, run npm install, then npm start.

5. Technical Trade-offs & Future Improvements
Current Hash: I used a hash based on name, size, and date for the handshake to keep it fast. In a real production app, I would use a partial file content hash for even better security.

Future Enhancement: I would add a "Pause" button to let the user stop the upload manually whenever they want, though the automatic resume currently handles page refreshes perfectly.