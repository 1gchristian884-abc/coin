const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Servir archivos estáticos desde la raíz del proyecto (index.html, etc.)
app.use(express.static(path.join(__dirname)));

const bot = new Telegraf('9006254534:AAH-VRqgfrtUSWSGF-cGoobS_QERMxfdLD0');

// Ruta obligatoria y directa para que TonConnect lea el manifiesto sin errores
app.get('/tonconnect-manifest.json', (req, res) => {
    res.sendFile(path.join(__dirname, 'tonconnect-manifest.json'));
});

app.post('/create-invoice', async (req, res) => {
    const { title, stars, userId } = req.body;
    try {
        const invoiceLink = await bot.telegram.createInvoiceLink({
            title: title,
            description: `Compra en VYCH Coin Miner: ${title}`,
            payload: `purchase_${userId}_${Date.now()}`,
            provider_token: "",
            currency: "XTR",
            prices: [{ label: title, amount: Number(stars) }]
        });
        res.json({ invoiceLink });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "No se pudo crear la factura" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor activo en el puerto ${PORT}`);
});
