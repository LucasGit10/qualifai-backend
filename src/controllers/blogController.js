const Post = require('../models/PostsBlog');
const fs = require('fs');
const path = require('path');

exports.getAllPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const posts = await Post.find()
            .populate('author', 'name')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .select('title slug excerpt author createdAt tags imageUrl');

        const total = await Post.countDocuments();
        res.json({ posts, totalPages: Math.ceil(total / limit), currentPage: parseInt(page, 10) });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar posts.' });
    }
};

exports.getPostBySlug = async (req, res) => {
    try {
        const post = await Post.findOne({ slug: req.params.slug }).populate('author', 'name');
        if (!post) return res.status(404).json({ message: 'Post não encontrado.' });
        res.json(post);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar o post.' });
    }
};

exports.createPost = async (req, res) => {
    try {
        const { title, content, excerpt, tags } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ message: 'A imagem de capa é obrigatória.' });
        }

        const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        
        const newPost = new Post({
            title,
            content,
            excerpt,
            tags: tags || [],
            author: req.user.id,
            imageUrl
        });

        await newPost.save();
        res.status(201).json(newPost);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Já existe um post com este título.' });
        }
        res.status(500).json({ message: 'Erro ao criar o post.', error: error.message });
    }
};

exports.updatePost = async (req, res) => {
    try {
        const { title, content, excerpt, tags } = req.body;
        const post = await Post.findOne({ slug: req.params.slug });

        if (!post) {
            return res.status(404).json({ message: 'Post não encontrado.' });
        }

        const updateData = { title, content, excerpt, tags };
        
        if (req.file) {
            const oldImagePath = path.join(__dirname, '..', 'uploads', path.basename(post.imageUrl));
            fs.unlink(oldImagePath, (err) => {
                if (err) console.error("Erro ao deletar imagem antiga:", err);
            });
            updateData.imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        }
        
        const updatedPost = await Post.findOneAndUpdate({ slug: req.params.slug }, updateData, { new: true, runValidators: true });
        res.json(updatedPost);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'O novo título já está em uso.' });
        }
        res.status(500).json({ message: 'Erro ao atualizar o post.', error: error.message });
    }
};

exports.deletePost = async (req, res) => {
    try {
        const post = await Post.findOneAndDelete({ slug: req.params.slug });

        if (!post) {
            return res.status(404).json({ message: 'Post não encontrado.' });
        }

        const imagePath = path.join(__dirname, '..', 'uploads', path.basename(post.imageUrl));
        fs.unlink(imagePath, (err) => {
            if (err) console.error("Erro ao deletar a imagem:", err);
        });

        res.json({ message: 'Post deletado com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao deletar o post.' });
    }
};