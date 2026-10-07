#!/usr/bin/env node
// Faux boîtier GT06 pour tester le serveur TCP (sur le VPS ou en local) sans matériel.
//   node scripts/gt06-sim.js <hôte> <port> <imei 15 chiffres> [vitesse_km_h]
// Il se connecte, envoie position + battement de coeur, et répond aux commandes de coupure
// comme un vrai boîtier (refus au-dessus de 20 km/h).
const net = require('net');
const gt06 = require('../src/tcp/gt06');

const [host = '127.0.0.1', port = '5023', imei = '861234567890123', speedArg = '30'] = process.argv.slice(2);
let speed = +speedArg, cut = false, serial = 0;
let pos = { lat: -4.325, lng: 15.322 };
const next = () => (serial = (serial + 1) & 0xffff);
let buf = Buffer.alloc(0);

const sock = net.connect(+port, host, () => { console.log('connecté, login…'); sock.write(gt06.encodeLogin(imei, next())); });
const sendPos = () => {
  pos = { lat: pos.lat + 0.0002, lng: pos.lng + 0.0002 };
  sock.write(gt06.encodeLocation(gt06.PROTO.GPS_22, { t: Date.now(), ...pos, speed, heading: 45, acc: speed > 0 }, next()));
};
const sendStatus = () => sock.write(gt06.encodeStatus({ acc: speed > 0, cut, voltage: 5 }, next()));

sock.on('data', (d) => {
  const r = gt06.extractFrames(Buffer.concat([buf, d]));
  buf = Buffer.from(r.rest);
  for (const f of r.frames) {
    if (f.proto === gt06.PROTO.LOGIN) { console.log('login accepté'); sendPos(); sendStatus(); }
    else if (f.proto === gt06.PROTO.COMMAND) {
      const flag = f.content.readUInt32BE(1);
      const text = f.content.subarray(5, 1 + f.content[0]).toString('ascii');
      console.log('commande reçue :', text);
      let reply;
      if (/^DYD/i.test(text)) { if (speed > 20) reply = 'DYD=Fail! speed too high'; else { cut = true; reply = 'DYD=Success!'; } }
      else if (/^HFYD/i.test(text)) { cut = false; reply = 'HFYD=Success!'; }
      else reply = 'Unknown command';
      sock.write(gt06.encodeCommandReply(flag, reply, next()));
      console.log('réponse :', reply);
    }
  }
});
setInterval(() => sock.writable && sendPos(), 5000);
setInterval(() => sock.writable && sendStatus(), 30000);
sock.on('close', () => { console.log('connexion fermée'); process.exit(0); });
sock.on('error', (e) => { console.error(e.message); process.exit(1); });
