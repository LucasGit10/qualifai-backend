const { getModel } = require('../../utils/modelProvider');
const Column = getModel('Column');
const Card = getModel('Card');
const Board = getModel('Board');

const KanbanController = {
  // Board Controllers
   async createBoard(req, res) {
        try {
        console.log('📥 Dados recebidos no backend:', req.body);  
        const { name } = req.body;

        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: 'Usuário não autenticado' });
        }

        const board = new Board({ 
            name, 
            user: req.user.id 
        });

        await board.save();

        // Cria colunas padrão vinculadas ao usuário
        const defaultColumns = [
            { title: '📋 To Do', position: 0, board: board._id, user: req.user.id },
            { title: '🚀 In Progress', position: 1, board: board._id, user: req.user.id },
            { title: '✅ Done', position: 2, board: board._id, user: req.user.id }
        ];

        const createdColumns = await Column.insertMany(defaultColumns);
        board.columns = createdColumns.map(col => col._id);
        await board.save();

        res.status(201).json(board);
        } catch (err) {
        res.status(400).json({ error: err.message });
        }
    },

// kanbanController.js

    async getBoard(req, res) {
        try {
        const board = await Board.findOne({
            _id: req.params.id,
            user: req.user.id
        }).populate({
            path: 'columns',
            match: { user: req.user.id },
            populate: {
            path: 'items',
            match: { user: req.user.id }
            }
        });
        
        if (!board) {
            return res.status(404).json({ error: 'Board não encontrado' });
        }
        
        res.json(board);
        } catch (err) {
        res.status(500).json({ error: err.message });
        }
    },

// Repita para todos os outros métodos (getColumns, createCard, etc)

  // Column Controllers
    async createColumn(req, res) {
        try {
        const { title, boardId } = req.body;
        
        if (!title) return res.status(400).json({ error: 'Título é obrigatório' });
        if (!boardId) return res.status(400).json({ error: 'boardId é obrigatório' });
        
        const board = await Board.findById(boardId);
        if (!board) return res.status(404).json({ error: 'Board não encontrado' });

        if (board.user.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Não autorizado' });
        }
        
        const lastColumn = await Column.findOne({ board: boardId }).sort('-position');
        const newPosition = lastColumn ? lastColumn.position + 1 : 0;
        
        const column = new Column({ 
            title, 
            position: newPosition,
            board: boardId,
            user: req.user.id
        });
        
        await column.save();
        board.columns.push(column._id);
        await board.save();
        
        res.status(201).json(column);
        } catch (err) {
        console.error('Error in createColumn:', err);
        res.status(400).json({ error: err.message });
        }
    },

    async getColumns(req, res) {
        try {
        const { boardId } = req.params;
        const columns = await Column.find({ 
            board: boardId,
            user: req.user.id 
        }).sort('position');
        
        const columnsWithCards = await Promise.all(
            columns.map(async column => {
            const cards = await Card.find({ 
                columnId: column._id,
                user: req.user.id
            }).sort('position');
            return {
                ...column.toObject(),
                items: cards
            };
            })
        );
        
        res.json(columnsWithCards);
        } catch (err) {
        res.status(500).json({ error: err.message });
        }
    },


  async updateColumn(req, res) {
    try {
      const { title } = req.body;
      const column = await Column.findByIdAndUpdate(
        req.params.id,
        { title },
        { new: true }
      );
      
      if (!column) {
        return res.status(404).json({ error: 'Coluna não encontrada' });
      }
      
      res.json(column);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  },

  async deleteColumn(req, res) {
    try {
      const { moveToColumnId } = req.body;
      const columnId = req.params.id;
      
      if (!moveToColumnId) {
        return res.status(400).json({ error: 'ID da coluna de destino é obrigatório' });
      }
      
      // Verificar se a coluna de destino existe
      const targetColumn = await Column.findById(moveToColumnId);
      if (!targetColumn) {
        return res.status(404).json({ error: 'Coluna de destino não encontrada' });
      }
      
      // Mover todos os cards para a nova coluna
      const cardsToMove = await Card.find({ columnId });
      const lastCardPosition = await Card.findOne({ columnId: moveToColumnId }).sort('-position');
      let newPosition = lastCardPosition ? lastCardPosition.position + 1 : 0;
      
      await Promise.all(
        cardsToMove.map(async (card, index) => {
          card.columnId = moveToColumnId;
          card.position = newPosition + index;
          await card.save();
        })
      );
      
      // Remover a coluna do board
      const board = await Board.findOne({ columns: columnId });
      if (board) {
        board.columns.pull(columnId);
        await board.save();
      }
      
      // Remover a coluna
      await Column.findByIdAndDelete(columnId);
      
      res.json({ message: 'Coluna removida com sucesso' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  // Card Controllers
    async createCard(req, res) {
    try {
        console.log('📥 Dados recebidos no backend:', req.body);
        
        const { title, description, priority, tags, columnId } = req.body;
        const userId = req.user?.id; // Captura do usuário autenticado

        if (!userId) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
        }

        // Verifica se a coluna existe
        const column = await Column.findById(columnId);
        if (!column) {
        return res.status(404).json({ error: 'Coluna não encontrada' });
        }

        // Última posição na coluna
        const lastCard = await Card.findOne({ columnId }).sort('-position');
        const newPosition = lastCard ? lastCard.position + 1 : 0;

        const colors = [ /* cores... */ ];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        const card = new Card({
        title,
        description: description || '',
        color: randomColor,
        priority: priority || 'Baixa',
        tags: tags || [],
        columnId,
        position: newPosition,
        user: userId // 👈 Adicionando o campo exigido
        });

        await card.save();
        res.status(201).json(card);

    } catch (err) {
        console.error('❌ Erro ao criar card:', err);
        res.status(400).json({ error: err.message });
    }
    },

  async getCard(req, res) {
    try {
      const card = await Card.findById(req.params.id);
      
      if (!card) {
        return res.status(404).json({ error: 'Card não encontrado' });
      }
      
      res.json(card);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  async updateCard(req, res) {
    try {
      const { title, description, priority, tags } = req.body;
      const card = await Card.findByIdAndUpdate(
        req.params.id,
        { title, description, priority, tags },
        { new: true }
      );
      
      if (!card) {
        return res.status(404).json({ error: 'Card não encontrado' });
      }
      
      res.json(card);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  },

   async moveCard(req, res) {
        try {
            const { columnId, position } = req.body;
            const cardId = req.params.id;
            
            // 1. Encontrar o card atual
            const card = await Card.findById(cardId);
            if (!card) {
            return res.status(404).json({ error: 'Card não encontrado' });
            }
            
            // 2. Se mudou de coluna
            if (card.columnId.toString() !== columnId) {
            // Atualizar posições na coluna antiga
            await Card.updateMany(
                { 
                columnId: card.columnId,
                position: { $gt: card.position }
                },
                { $inc: { position: -1 } }
            );
            
            // Atualizar posições na nova coluna para abrir espaço
            await Card.updateMany(
                { 
                columnId,
                position: { $gte: position }
                },
                { $inc: { position: 1 } }
            );
            
            // Atualizar o card
            card.columnId = columnId;
            card.position = position;
            } else {
            // Mesma coluna, apenas reordenar
            if (card.position < position) {
                await Card.updateMany(
                { 
                    columnId,
                    position: { $gt: card.position, $lte: position }
                },
                { $inc: { position: -1 } }
                );
            } else {
                await Card.updateMany(
                { 
                    columnId,
                    position: { $lt: card.position, $gte: position }
                },
                { $inc: { position: 1 } }
                );
            }
            
            card.position = position;
            }
            
            await card.save();
            res.json(card);
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    },

  async deleteCard(req, res) {
    try {
      const card = await Card.findByIdAndDelete(req.params.id);
      
      if (!card) {
        return res.status(404).json({ error: 'Card não encontrado' });
      }
      
      // Ajustar posições dos cards restantes
      await Card.updateMany(
        { 
          columnId: card.columnId,
          position: { $gt: card.position }
        },
        { $inc: { position: -1 } }
      );
      
      res.json({ message: 'Card removido com sucesso' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  // Funções auxiliares para o frontend
  async getInitialData(req, res) {
    try {
      // Busca o board do usuário logado
      let board = await Board.findOne({ user: req.user.id });

      // Se não existir, cria um novo board para o usuário
      if (!board) {
        board = new Board({ 
          name: 'Meu Kanban Board',
          user: req.user.id
        });

        const defaultColumns = [
          { title: '📋 To Do', position: 0, board: board._id, user: req.user.id },
          { title: '🚀 In Progress', position: 1, board: board._id, user: req.user.id },
          { title: '✅ Done', position: 2, board: board._id, user: req.user.id }
        ];

        const createdColumns = await Column.insertMany(defaultColumns);
        board.columns = createdColumns.map(col => col._id);
        await board.save();
      }

      // Busca as colunas do board do usuário
      const columns = await Column.find({ board: board._id, user: req.user.id }).sort('position').lean();

      // Para cada coluna, busca os cards
      const columnsWithCards = await Promise.all(
        columns.map(async (column) => {
          const cards = await Card.find({ 
            columnId: column._id,
            user: req.user.id
          }).sort('position').lean();
          return {
            ...column,
            items: cards
          };
        })
      );

      res.json({
        _id: board._id,
        name: board.name,
        columns: columnsWithCards
      });
    } catch (err) {
      console.error('Erro ao buscar dados iniciais:', err);
      res.status(500).json({ error: err.message });
    }
  }
};

module.exports = KanbanController;