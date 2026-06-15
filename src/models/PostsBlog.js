const mongoose = require('mongoose');
const slugify = require('slugify');

const postSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'O título do post é obrigatório.'],
        trim: true,
        unique: true
    },
    slug: {
        type: String,
        unique: true
    },
    content: {
        type: String,
        required: [true, 'O conteúdo do post é obrigatório.']
    },
    excerpt: {
        type: String,
        trim: true
    },
    imageUrl: {
        type: String,
        required: [true, 'A imagem de capa é obrigatória.']
    },
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    tags: {
        type: [String],
        default: []
    }
}, {
    timestamps: true
});

postSchema.pre('save', function(next) {
    if (this.isModified('title')) {
        this.slug = slugify(this.title, { lower: true, strict: true });
    }
    if (this.isModified()) {
        this.updatedAt = Date.now();
    }
    next();
});

module.exports = mongoose.model('Post', postSchema);
