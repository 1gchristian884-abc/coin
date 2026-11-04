const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const bot = new Telegraf('
9006254534:AAH-VRqgfrtUSWSGF-cGoobS_QERMxfdLD0');

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
