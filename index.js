const {
	default: makeWASocket,
	fetchLatestBaileysVersion,
	makeCacheableSignalKeyStore,
	makeInMemoryStore,
	PHONENUMBER_MCC,
	useMultiFileAuthState,
	Browsers,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const NodeCache = require("node-cache");
const readline = require("readline");
/** Change it to true if needed */
const useStore = false;

const { GoogleGenerativeAI } = require("@google/generative-ai");
// const dotenv = require('dotenv');
// dotenv.config();
const apikeyGemini = 'AIzaSyBAkMQTV4K0EixA19ebw0FkhI7ns5L2LaQ'
const genAI = new GoogleGenerativeAI(apikeyGemini);

const MAIN_LOGGER = pino({
	timestamp: () => `,"time":"${new Date().toJSON()}"`,
});

const logger = MAIN_LOGGER.child({});
logger.level = "trace";

const store = useStore ? makeInMemoryStore({ logger }) : undefined; // Inisialisasi store jika penggunaan store diaktifkan
store?.readFromFile(`store.json`);

setInterval(() => {
	store?.writeToFile("store.json");
}, 60000 * 60);

const msgRetryCounterCache = new NodeCache();

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});
const question = text => new Promise(resolve => rl.question(text, resolve));

const P = require("pino")({
	level: "silent",
});

const getAnswerGemini = async (message) => {
	const model = genAI.getGenerativeModel({ model: "gemini-pro" })
	const result = await model.generateContent(message);
	const response = await result.response;
	return response.text();
}

async function start() {
	let { state, saveCreds } = await useMultiFileAuthState("AUTH");
	let { version, isLatest } = await fetchLatestBaileysVersion();
	const sock = makeWASocket({
		version,
		logger: P,
		printQRInTerminal: true,
		browser: Browsers.windows("Chrome"),
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys, P),
		},
		msgRetryCounterCache,
	});
	store?.bind(sock.ev);

	sock.ev.on("creds.update", saveCreds);

	if (!sock.authState.creds.registered) {
		const phoneNumber = await question("Enter your active whatsapp number: ");
		const code = await sock.requestPairingCode(phoneNumber);
		console.log(`pairing with this code: ${code}`);
	}

	// to upsert message from whatsapp
	sock.ev.process(async events => {
		if (events["connection.update"]) {
			const update = events["connection.update"];
			const { connection, lastDisconnect } = update;
			if (connection === "close") {
				if (
					lastDisconnect &&
					lastDisconnect.error &&
					lastDisconnect.error.output
					// lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
				) {
					start();
				} else {
					console.log("Connection closed. You are logged out.");
				}
			}
			console.log("connection update", update);
		}
	});
	// return sock;
	sock.ev.on('messages.upsert', async ({ messages, type }) => {
		// if (messages[0].key.fromMe) return;
		// console.log(JSON.stringify(m, undefined, 2))

		// console.log('replying to', messages[0].key.remoteJid)
		// await sock.sendMessage(messages[0].key.remoteJid, { text: 'Hello there!' })

		if (type === "notify") {
			// console.log(messages);
			const isMessageFromGroup = messages[0].key.remoteJid.includes("@g.us");
			const isMessageMentionBot = messages[0].message?.extendedTextMessage?.text.includes("@6285156945859");
			// console.log(isMessageFromGroup);
			// console.log(isMessageMentionBot);
			if (!messages[0].key.participant) {

				//tentukan jenis pesan berbentuk text                
				const pesan = messages[0].message?.conversation;
				//tentukan jenis pesan apakah bentuk list
				const responseList = messages[0].message?.listResponseMessage;
				//tentukan jenis pesan apakah bentuk button
				const responseButton = messages[0].message?.buttonsResponseMessage;
				//tentukan jenis pesan apakah bentuk templateButtonReplyMessage
				const responseReplyButton = messages[0].message?.templateButtonReplyMessage;
				//nowa dari pengirim pesan sebagai id
				const noWa = messages[0].key.remoteJid;
				//update status read (centang 2 bitu pada wa user) 
				await sock.readMessages([messages[0].key]);
				//kecilkan semua pesan yang masuk lowercase 
				const pesanMasuk = pesan?.toLowerCase();
				console.log(pesanMasuk);

				if (pesanMasuk?.includes("?") || pesanMasuk?.includes("!")) {
					// const getDataAi = await getResponseAI(pesanMasuk);
					const getDataAi = await getAnswerGemini(pesanMasuk);

					await sock.sendMessage(noWa, { text: getDataAi }, { quoted: messages[0] });
				}
				else {
					let jawabankata = "_Kata kunci tidak dikenali_ \n_Gunakan kata kunci dengan menambahkan *TANDA TANYA (?)* atau *TANDA SERU (!)* untuk menanyakan ke Gemini AI._\n\n*Contoh :*\n_Assalamu'alaikum_ *!*";
					await sock.sendMessage(noWa, { text: jawabankata }, { quoted: messages[0] });
				}
			}
			if (isMessageFromGroup && isMessageMentionBot) {

				const pesan = messages[0].message?.extendedTextMessage.text;
				const pesanMasuk = pesan.toLowerCase();
				const noWa = messages[0].key.remoteJid;

				console.log(pesanMasuk);
				// console.log(pesanMasuk);
				// const getDataAi = await getResponseAI(pesanMasuk);
				const getDataAi = await getAnswerGemini(pesanMasuk);
				// console.log(messages[0]);

				await sock.sendMessage(noWa, { text: getDataAi }, { quoted: messages[0] });
				// console.log('ini pertama');
				return;
			}
		}

	})
}

start();

