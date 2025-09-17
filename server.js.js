// Añade estas rutas después de las rutas de autenticación

// Ruta para el panel de cuenta
app.get('/account', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login.html');
    }
    
    try {
        const db = client.db();
        const user = await db.collection('users').findOne({ 
            _id: new ObjectId(req.session.userId) 
        });
        
        // Obtener URLs del usuario
        const userUrls = await db.collection('urls').find({ 
            userId: req.session.userId 
        }).toArray();
        
        res.render('account', { 
            user: {
                id: user._id,
                email: user.email,
                plan: user.plan
            },
            urls: userUrls
        });
    } catch (error) {
        console.error('Error loading account:', error);
        res.redirect('/');
    }
});

// API para añadir URLs
app.post('/api/urls', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    
    try {
        const { url, notificationEmail, telegramId, notificationType } = req.body;
        const db = client.db();
        
        // Verificar límite según plan
        const urlCount = await db.collection('urls').countDocuments({ 
            userId: req.session.userId 
        });
        
        const user = await db.collection('users').findOne({ 
            _id: new ObjectId(req.session.userId) 
        });
        
        if (user.plan === 'free' && urlCount >= 5) {
            return res.status(400).json({ 
                error: 'Límite de 5 webs alcanzado. Mejora a Premium para webs ilimitadas.' 
            });
        }
        
        // Guardar URL
        const result = await db.collection('urls').insertOne({
            userId: req.session.userId,
            url: url,
            notificationEmail: notificationEmail,
            telegramId: telegramId,
            notificationType: notificationType || 'email',
            checkTime: '12:00', // Siempre a las 12:00
            lastChecked: null,
            lastHash: '',
            createdAt: new Date(),
            isActive: true
        });
        
        res.json({ 
            success: true, 
            message: 'URL añadida correctamente',
            urlId: result.insertedId 
        });
        
    } catch (error) {
        console.error('Error adding URL:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// API para eliminar URLs
app.delete('/api/urls/:id', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    
    try {
        const db = client.db();
        await db.collection('urls').deleteOne({
            _id: new ObjectId(req.params.id),
            userId: req.session.userId
        });
        
        res.json({ success: true, message: 'URL eliminada correctamente' });
    } catch (error) {
        console.error('Error deleting URL:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});