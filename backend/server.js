// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yauzl = require('yauzl');


const app = express();
// const upload = multer({ dest: 'temp/' });
const TEMP_DIR = '/data/temp';
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}
const upload = multer({ dest: TEMP_DIR });


// app.use(cors());
app.use(cors({
  origin: [
    'https://zip-analyzer.vercel.app'
  ],
  methods: ['GET', 'POST']
}));

app.use(express.json());

// const pool = mysql.createPool({
//   host: 'localhost',
//   user: 'root',
//   password: '123456', 
//   database: 'chunked_uploads',
//   waitForConnections: true,
//   connectionLimit: 50
// });

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 50
});


// const UPLOAD_DIR = path.join(__dirname, 'uploads');
const UPLOAD_DIR = '/data/uploads';
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 1. Handshake with Resume Logic
app.post('/handshake', async (req, res) => {
  const { fileHash, filename, totalSize, totalChunks } = req.body;
  let connection;
  try {
    connection = await pool.getConnection();
    const [uploads] = await connection.execute('SELECT id, status FROM uploads WHERE id = ?', [fileHash]);

    if (uploads.length > 0) {
      const [chunks] = await connection.execute(
        'SELECT chunk_index FROM chunks WHERE upload_id = ? AND status = "UPLOADED"',
        [fileHash]
      );
      return res.json({ uploadId: fileHash, exists: true, status: uploads[0].status, uploadedChunks: chunks.map(c => c.chunk_index) });
    }

    await connection.execute(
      'INSERT INTO uploads (id, filename, total_size, total_chunks, status) VALUES (?, ?, ?, ?, "UPLOADING")',
      [fileHash, filename, totalSize, totalChunks]
    );

    // Bulk insert chunk placeholders
    const values = Array.from({ length: totalChunks }, (_, i) => [fileHash, i, 'PENDING']);
    await connection.query('INSERT INTO chunks (upload_id, chunk_index, status) VALUES ?', [values]);

    res.json({ uploadId: fileHash, exists: false, uploadedChunks: [] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Handshake failed" });
  } finally {
    if (connection) connection.release();
  }
});

// 2. Resilient Chunk Upload
app.post('/upload-chunk', upload.single('chunk'), async (req, res) => {
  const { uploadId, chunkIndex } = req.body;
  const chunkFile = req.file;
  let connection;

  try {
    if (!chunkFile) throw new Error("No file");
    connection = await pool.getConnection();
    const targetFile = path.join(UPLOAD_DIR, `${uploadId}.zip`);
    
    // Ensure file exists for writing at offset
    if (!fs.existsSync(targetFile)) fs.writeFileSync(targetFile, '');

    const chunkData = fs.readFileSync(chunkFile.path);
    const position = parseInt(chunkIndex) * 5 * 1024 * 1024; // 5MB

    const fd = fs.openSync(targetFile, 'r+');
    fs.writeSync(fd, chunkData, 0, chunkData.length, position);
    fs.closeSync(fd);

    await connection.execute(
      'UPDATE chunks SET status = "UPLOADED", received_at = NOW() WHERE upload_id = ? AND chunk_index = ?',
      [uploadId, parseInt(chunkIndex)]
    );

    fs.unlinkSync(chunkFile.path);
    res.json({ message: 'Chunk saved', index: chunkIndex });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Chunk upload failed" });
  } finally {
    if (connection) connection.release();
  }
});

// 3. Finalize with Bonus: Double-Finalize protection (Character Limit Fix)
app.post('/finalize', async (req, res) => {
  const { uploadId } = req.body;
  let connection;
  try {
    connection = await pool.getConnection();
    
    // FIX: Hash the lock name so it never exceeds 64 characters
    const lockName = crypto.createHash('md5').update(`finalize_${uploadId}`).digest('hex');
    
    // Bonus: Prevent Double Finalize using MySQL locking 
    const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 5) as lockStatus', [lockName]);
    if (lockRows[0].lockStatus !== 1) {
      return res.status(423).json({ error: "Finalization already in progress" });
    }

    // Check if already completed to prevent redundant work
    const [upload] = await connection.execute('SELECT status FROM uploads WHERE id = ?', [uploadId]);
    if (upload[0].status === 'COMPLETED') {
      await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]);
      return res.json({ message: "Already completed" });
    }

    // Update status to processing [cite: 42]
    await connection.execute('UPDATE uploads SET status = "PROCESSING" WHERE id = ?', [uploadId]);

    const targetFile = path.join(UPLOAD_DIR, `${uploadId}.zip`);
    
    // Resilient Requirement: Calculate SHA-256 hash [cite: 34]
    const hash = await calculateFileHash(targetFile);
    
    // Peek Requirement: List top-level filenames without extracting 
    const filesInZip = await peekZip(targetFile);

    // Final database update [cite: 42]
    await connection.execute(
      'UPDATE uploads SET status = "COMPLETED", final_hash = ? WHERE id = ?',
      [hash, uploadId]
    );

    // Clean up: Release the lock
    await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]);
    
    res.json({ 
      message: "Upload finalized successfully", 
      hash, 
      filesInZip 
    });

  } catch (error) {
    console.error("Finalization error:", error);
    res.status(500).json({ error: "Finalization failed during assembly" });
  } finally {
    if (connection) connection.release();
  }
});

function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function peekZip(filePath) {
  return new Promise((resolve, reject) => {
    const files = [];
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return resolve(["Could not peek ZIP"]);
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (!entry.fileName.includes('/')) files.push(entry.fileName);
        zipfile.readEntry();
      });
      zipfile.on('end', () => resolve(files.slice(0, 10)));
      zipfile.on('error', () => resolve(["Error reading ZIP"]));
    });
  });
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
