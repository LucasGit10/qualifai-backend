const mongoose = require('mongoose');
const { getModel } = require('../../utils/modelProvider');
const User = getModel('User');
const Lead = getModel('Lead');
const hubspotService = require('../../services/hubspotService');
const kommoService = require('../../services/kommoService');
const pipedriveService = require('../../services/pipedriveService');
const zohoService = require('../../services/zohoService');
const logger = require('../../utils/logger');
const Event = getModel('Events');

class CalendarController {
    async getEvents(req, res) {
        try {
            const userId = req.user.id;
            const { start, end } = req.query; // Expecting ISO date strings

            if (!start || !end) {
                return res.status(400).json({ message: 'Start and end query parameters are required.' });
            }
            
            // Only fetch from local DB and return
            const dbEvents = await Event.find({
                user: userId,
                start: { $lte: new Date(end) },
                end: { $gte: new Date(start) }
            }).populate('lead', 'name');

            const formattedEvents = dbEvents.map(e => ({
                id: e._id.toString(),
                title: e.title,
                start: e.start,
                end: e.end,
                resource: {
                    leadId: e.lead?._id,
                    leadName: e.lead?.name || 'Lead not associated',
                    crm: Array.from(e.crmIds.keys()).filter(k => k !== 'manual').join(', ') || 'manual',
                    meetLink: e.meetLink
                }
            }));
            
            res.json(formattedEvents);

        } catch (error) {
            logger.error('Error getting calendar events:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    async syncEvents(req, res) {
        try {
            const userId = req.user.id;
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            const userSettings = { ...user.settings, userId };
            const syncStats = {};

            const today = new Date();
            const start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
            const end = new Date(today.getFullYear(), today.getMonth() + 2, 0).toISOString();

            // PULL FROM KOMMO
            if (user.settings?.integrations?.kommo?.enabled) {
                try {
                    const kommoEvents = await kommoService.fetchKommoTasks(userSettings, start, end);
                    syncStats.kommo = { synced: 0, errors: 0 };
                    if (kommoEvents && kommoEvents.length > 0) {
                        const ops = kommoEvents.map(evt => ({
                            updateOne: {
                                filter: { user: userId, 'crmIds.kommo': evt.id.replace('kommo-', '') },
                                update: { $set: {
                                    title: evt.title,
                                    start: new Date(evt.start),
                                    end: new Date(evt.end),
                                    user: userId,
                                    lead: evt.resource.leadId,
                                    'crmIds.kommo': evt.id.replace('kommo-', '')
                                }},
                                upsert: true
                            }
                        }));
                        const result = await Event.bulkWrite(ops);
                        syncStats.kommo.synced = result.upsertedCount + result.modifiedCount;
                    }
                } catch (error) {
                    logger.error(`Error syncing Kommo tasks for user ${userId}:`, { message: error.message });
                    syncStats.kommo = { ...syncStats.kommo, error: error.message };
                }
            }

            // PULL FROM PIPEDRIVE
            if (user.settings?.integrations?.pipedrive?.enabled) {
                try {
                    const pipedriveEvents = await pipedriveService.fetchPipedriveActivities(userSettings, start, end);
                    syncStats.pipedrive = { synced: 0, errors: 0 };
                     if (pipedriveEvents && pipedriveEvents.length > 0) {
                        const ops = pipedriveEvents.map(evt => ({
                            updateOne: {
                                filter: { user: userId, 'crmIds.pipedrive': evt.id.replace('pipedrive-', '') },
                                update: { $set: {
                                    title: evt.title,
                                    start: new Date(evt.start),
                                    end: new Date(evt.end),
                                    user: userId,
                                    lead: evt.resource.leadId,
                                    'crmIds.pipedrive': evt.id.replace('pipedrive-', '')
                                }},
                                upsert: true
                            }
                        }));
                        const result = await Event.bulkWrite(ops);
                        syncStats.pipedrive.synced = result.upsertedCount + result.modifiedCount;
                    }
                } catch (error) {
                    logger.error(`Error syncing Pipedrive activities for user ${userId}:`, { message: error.message });
                     syncStats.pipedrive = { ...syncStats.pipedrive, error: error.message };
                }
            }
            
            // PULL FROM HUBSPOT
            if (user.settings?.integrations?.hubspot?.enabled) {
                try {
                    const hubspotEvents = await hubspotService.fetchHubspotTasks(userSettings, start, end);
                    syncStats.hubspot = { synced: 0, errors: 0 };
                    if (hubspotEvents && hubspotEvents.length > 0) {
                        const ops = hubspotEvents.map(evt => ({
                            updateOne: {
                                filter: { user: userId, 'crmIds.hubspot': evt.id.replace('hubspot-', '') },
                                update: { $set: {
                                    title: evt.title,
                                    start: new Date(evt.start),
                                    end: new Date(evt.end),
                                    user: userId,
                                    lead: evt.resource.leadId,
                                    'crmIds.hubspot': evt.id.replace('hubspot-', '')
                                }},
                                upsert: true
                            }
                        }));
                        const result = await Event.bulkWrite(ops);
                        syncStats.hubspot.synced = result.upsertedCount + result.modifiedCount;
                    }
                } catch (error) {
                    logger.error(`Error syncing HubSpot tasks for user ${userId}:`, { message: error.message });
                    syncStats.hubspot = { ...syncStats.hubspot, error: error.message };
                }
            }

            // PULL FROM ZOHO
            if (user.settings?.integrations?.zoho?.enabled) {
                try {
                    const zohoEvents = await zohoService.fetchZohoEvents(userSettings, start, end);
                    syncStats.zoho = { synced: 0, errors: 0 };
                    if (zohoEvents && zohoEvents.length > 0) {
                        const ops = zohoEvents.map(evt => ({
                            updateOne: {
                                filter: { user: userId, 'crmIds.zoho': evt.id.replace('zoho-', '') },
                                update: { $set: {
                                    title: evt.title,
                                    start: new Date(evt.start),
                                    end: new Date(evt.end),
                                    user: userId,
                                    lead: evt.resource.leadId,
                                    'crmIds.zoho': evt.id.replace('zoho-', '')
                                }},
                                upsert: true
                            }
                        }));
                        const result = await Event.bulkWrite(ops);
                        syncStats.zoho.synced = result.upsertedCount + result.modifiedCount;
                    }
                } catch (error) {
                    logger.error(`Error syncing Zoho events for user ${userId}:`, { message: error.message });
                    syncStats.zoho = { ...syncStats.zoho, error: error.message };
                }
            }

            // PUSH LOGIC: Find local events and create them in enabled CRMs
            const localEvents = await Event.find({ user: userId, lead: { $exists: true, $ne: null } }).populate('lead');

            for (const event of localEvents) {
                if (!event.lead) continue;
    
                // PUSH to Pipedrive
                if (user.settings?.integrations?.pipedrive?.enabled && !event.crmIds.get('pipedrive')) {
                    try {
                        if (!event.lead.pipedrive?.personId) {
                            logger.info(`[Sync Push] Lead ${event.lead._id} is not yet synced with Pipedrive. Syncing now...`);
                            await event.lead.syncWithPipedrive(userSettings);
                            // After sync, the lead object in memory should have the personId.
                        }

                        const eventDetails = { title: event.title, description: event.description, startTime: event.start, endTime: event.end };
                        const createdActivity = await pipedriveService.createPipedriveActivity(event.lead, eventDetails, userSettings);
                        await Event.updateOne({ _id: event._id }, { $set: { 'crmIds.pipedrive': String(createdActivity.id) } });

                        if (!syncStats.pipedrive) syncStats.pipedrive = { synced: 0, created: 0, errors: 0 };
                        syncStats.pipedrive.created = (syncStats.pipedrive.created || 0) + 1;
                    } catch (error) {
                        logger.error(`[Sync Push] Error pushing event ${event._id} to Pipedrive:`, { message: error.message });
                        if (!syncStats.pipedrive) syncStats.pipedrive = { synced: 0, created: 0, errors: 0 };
                        syncStats.pipedrive.errors = (syncStats.pipedrive.errors || 0) + 1;
                    }
                }
    
                // PUSH to Kommo
                if (user.settings?.integrations?.kommo?.enabled && !event.crmIds.get('kommo')) {
                    try {
                        if (!event.lead.kommo?.id) {
                            logger.info(`[Sync Push] Lead ${event.lead._id} is not yet synced with Kommo. Syncing now...`);
                            await event.lead.syncWithKommo(userSettings);
                        }

                        const kommoEventDetails = { text: event.title, complete_till: Math.floor(event.end.getTime() / 1000) };
                        const createdTask = await kommoService.createKommoTask(event.lead, userSettings, kommoEventDetails);
                        await Event.updateOne({ _id: event._id }, { $set: { 'crmIds.kommo': String(createdTask.id) } });

                        if (!syncStats.kommo) syncStats.kommo = { synced: 0, created: 0, errors: 0 };
                        syncStats.kommo.created = (syncStats.kommo.created || 0) + 1;
                    } catch (error) {
                        logger.error(`[Sync Push] Error pushing event ${event._id} to Kommo:`, { message: error.message });
                        if (!syncStats.kommo) syncStats.kommo = { synced: 0, created: 0, errors: 0 };
                        syncStats.kommo.errors = (syncStats.kommo.errors || 0) + 1;
                    }
                }
            }

            res.json({ success: true, message: 'CRM sync complete.', stats: syncStats });

        } catch (error) {
            logger.error('Error syncing calendar events:', error);
            res.status(500).json({ message: 'Internal server error during sync' });
        }
    }

    async createEvent(req, res) {
        try {
            const userId = req.user.id;
            const { title, start, end, description, lead: leadId } = req.body;

            if (!title || !start || !end) {
                return res.status(400).json({ message: 'Title, start, and end are required fields.' });
            }

            const newEvent = new Event({
                title,
                start: new Date(start),
                end: new Date(end),
                description,
                user: userId,
                ...(leadId && { lead: leadId }),
            });
            
            newEvent.crmIds.set('manual', `manual_${new mongoose.Types.ObjectId().toHexString()}`);
            await newEvent.save();

            res.status(201).json({
                id: newEvent._id.toString(),
                title: newEvent.title,
                start: newEvent.start,
                end: newEvent.end,
                resource: {
                    leadId: newEvent.lead,
                    crm: Array.from(newEvent.crmIds.keys())[0],
                }
            });
        } catch (error) {
            logger.error('Error creating manual event:', error);
            res.status(500).json({ message: 'Internal server error while creating event.' });
        }
    }
}

module.exports = new CalendarController();