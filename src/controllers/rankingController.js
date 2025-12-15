const mongoose = require('mongoose');
const User = require('../models/User');
const Lead = require('../models/Lead');
const logger = require('../utils/logger');

class RankingController {

    async getSalesRanking(req, res) {
        try {
            const user = req.user;
            let teamMemberIds = [];

            // Identificar os membros da equipe
            if (user.role === 'manager' || user.role === 'admin') {
                const salesUsers = await User.find({ managedBy: user._id }).select('_id');
                teamMemberIds = salesUsers.map(u => u._id);
            } else if (user.role === 'sales') {
                if (!user.managedBy) {
                    teamMemberIds = [user._id];
                } else {
                    const salesUsers = await User.find({ managedBy: user.managedBy }).select('_id');
                    teamMemberIds = salesUsers.map(u => u._id);
                }
            } else {
                return res.status(403).json({ message: 'Ranking disponível apenas para gerentes, vendedores e administradores.' });
            }

            if (teamMemberIds.length === 0) {
                // Se um manager ou admin não tem vendedores, retorna um array vazio
                 if (user.role === 'manager' || user.role === 'admin'){
                    return res.json([]);
                }
                // Se um vendedor não tem time (caso raro), ele ainda pode aparecer no ranking
                teamMemberIds = [user._id];
            }

            // Definir o período (mês atual)
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

            // Pipeline de agregação
            const ranking = await Lead.aggregate([
                // 1. Filtrar leads relevantes
                {
                    $match: {
                        user: { $in: teamMemberIds },
                        status: 'qualificado', // ALTERADO: de 'quente' para 'qualificado'
                        updatedAt: { $gte: startOfMonth, $lte: endOfMonth }
                    }
                },
                // 2. Agrupar por usuário e contar os leads
                {
                    $group: {
                        _id: '$user',
                        hotLeads: { $sum: 1 } // Nome do campo mantido para compatibilidade
                    }
                },
                // 3. Ordenar por contagem (maior para o menor)
                {
                    $sort: { hotLeads: -1 }
                },
                // 4. Juntar com a coleção de usuários para obter nomes
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'userDetails'
                    }
                },
                // 5. Desconstruir o array de detalhes do usuário
                {
                    $unwind: '$userDetails'
                },
                // 6. Formatar o resultado final
                {
                    $project: {
                        _id: 0,
                        userId: '$_id',
                        name: '$userDetails.name',
                        hotLeads: '$hotLeads'
                    }
                }
            ]);

            // Adicionar ranking e usuários que não qualificaram nenhum lead
            const userMap = new Map(ranking.map(item => [item.userId.toString(), item]));
            const allTeamUsers = await User.find({ _id: { $in: teamMemberIds } }).select('name');
            
            const fullRanking = allTeamUsers.map(teamUser => {
                const existingData = userMap.get(teamUser._id.toString());
                return {
                    userId: teamUser._id,
                    name: teamUser.name,
                    hotLeads: existingData ? existingData.hotLeads : 0,
                };
            }).sort((a, b) => b.hotLeads - a.hotLeads);

            res.json(fullRanking);

        } catch (error) {
            logger.error('Erro ao buscar o ranking de vendas:', error);
            res.status(500).json({ message: 'Erro interno do servidor' });
        }
    }
}

module.exports = new RankingController();