const express = require('express');
const router = express.Router();
const blogController = require('../../controllers/billing/blog.controller');
const auth = require('../../middleware/auth');
const admin = require('../../middleware/admin');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, `post-${Date.now()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({ storage });

router.get('/', blogController.getAllPosts);
router.get('/:slug', blogController.getPostBySlug);

router.post('/', auth, admin, upload.single('image'), blogController.createPost);
router.put('/:slug', auth, admin, upload.single('image'), blogController.updatePost);
router.delete('/:slug', auth, admin, blogController.deletePost);

module.exports = router;