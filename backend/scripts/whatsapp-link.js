// Vincula tu WhatsApp como dispositivo. Uso: npm run whatsapp:link
// Sin QR, con un código para tipear en el celular: npm run whatsapp:link -- 595981000001
// Con el backend apagado: dos conexiones con la misma sesión se expulsan entre sí.
import qrcode from 'qrcode-terminal';
import { connectWhatsApp } from '../src/services/whatsappSocket.js';

const phone = (process.argv[2] ?? '').replace(/\D/g, '');

function start() {
  let codeRequested = false;
  return connectWhatsApp({
    onConnectionUpdate: async ({ connection, lastDisconnect, qr }, socket) => {
      if (qr && phone) {
        if (codeRequested) return;
        codeRequested = true;
        try {
          const code = await socket.requestPairingCode(phone);
          console.log('\nEn tu celular: WhatsApp > Dispositivos vinculados > Vincular dispositivo > Vincular con el número de teléfono');
          console.log(`Código: ${code}\n`);
        } catch (err) {
          console.error(`\nNo se pudo pedir el código: ${err.message}`);
          process.exit(1);
        }
      } else if (qr) {
        console.log('\nEn tu celular: WhatsApp > Dispositivos vinculados > Vincular dispositivo\n');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        console.log('\nListo. Iniciá el backend y escribile a Violet en tu chat "Mensajes a mí mismo".');
        setTimeout(() => process.exit(0), 2000);
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        // WhatsApp pide reconectar justo después de escanear (515).
        if (code === 515) {
          start();
          return;
        }
        console.error(`\nNo se pudo vincular (código ${code}). Volvé a intentarlo.`);
        process.exit(1);
      }
    },
  });
}

await start();
