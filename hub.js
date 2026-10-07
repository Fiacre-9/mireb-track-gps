// Diffusion temps réel (Server-Sent Events), cloisonnée par entreprise.
const clients = new Set();

function add(res, cid) {
  const c = { res, cid };
  clients.add(c);
  return () => clients.delete(c);
}
function emit(cid, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) if (c.cid === cid) c.res.write(msg);
}
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25000).unref();

module.exports = { add, emit };
