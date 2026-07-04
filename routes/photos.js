const router = require('express').Router();
const auth = require('../middleware/auth');
const multer = require('multer');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB max raw upload before compression
});

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

const BUCKET = process.env.R2_BUCKET_NAME;

// Upload a photo for a job
router.post('/', auth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo received' });
    const { quote_id } = req.body;
    if (!quote_id) return res.status(400).json({ error: 'quote_id required' });

    const pool = req.app.locals.pool;

    // Confirm the job belongs to this user before attaching a photo to it
    const check = await pool.query('SELECT id FROM quotes WHERE id=$1 AND user_id=$2', [quote_id, req.user.id]);
    if (!check.rows.length) return res.status(404).json({ error: 'Job not found' });

    // Compress: resize to max 1600px wide, convert to JPEG at 75% quality
    const compressed = await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();

    const key = `${req.user.id}/${quote_id}/${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`;

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: compressed,
      ContentType: 'image/jpeg'
    }));

    const result = await pool.query(
      'INSERT INTO job_photos (user_id, quote_id, photo_url) VALUES ($1,$2,$3) RETURNING *',
      [req.user.id, quote_id, key]
    );

    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get all photos for a specific job (returns temporary secure view links)
router.get('/:quoteId', auth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'SELECT id, photo_url, created_at FROM job_photos WHERE quote_id=$1 AND user_id=$2 ORDER BY created_at DESC',
      [req.params.quoteId, req.user.id]
    );

    const photos = await Promise.all(result.rows.map(async (row) => {
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: row.photo_url }), { expiresIn: 3600 });
      return { id: row.id, url, created_at: row.created_at };
    }));

    res.json(photos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a photo
router.delete('/:id', auth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query('SELECT photo_url FROM job_photos WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Photo not found' });

    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: result.rows[0].photo_url }));
    await pool.query('DELETE FROM job_photos WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
