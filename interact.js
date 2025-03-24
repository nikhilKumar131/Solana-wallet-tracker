const {
    Connection,
    PublicKey,
    Keypair,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction
} = require("@solana/web3.js");

const borsh = require("borsh");

// 🔹 Solana local network URL (Ensure Solana Test Validator is running)
const SOLANA_RPC_URL = "http://127.0.0.1:8899";
const connection = new Connection(SOLANA_RPC_URL, "confirmed");

// 🔹 Replace this with your deployed program's ID
const PROGRAM_ID = new PublicKey("2f1eGGAKeLUYfa35m7sB3HLPM1q8wFRpajsVEcFHNZXS");

// 🔹 Generate a new account (or use an existing one)
const payer = Keypair.generate();
const greetedAccount = Keypair.generate(); // The account we will interact with

// 🔹 Define the Borsh schema for serialization
class GreetingAccount {
    constructor(fields = undefined) {
        this.counter = fields ? fields.counter : 0;
    }
}
const GreetingSchema = new Map([
    [GreetingAccount, { kind: "struct", fields: [["counter", "u32"]] }]
]);

// 🔹 Serialize data
function serializeData(account) {
    return Buffer.from(borsh.serialize(GreetingSchema, new GreetingAccount(account)));
}

// 🔹 Function to interact with the smart contract
async function interactWithContract() {
    console.log("🚀 Connecting to Solana localhost...");

    // 1️⃣ Airdrop SOL to the payer (for transaction fees)
    const airdropSignature = await connection.requestAirdrop(payer.publicKey, 1e9); // 1 SOL
    await connection.confirmTransaction(airdropSignature);
    console.log(`✅ Airdropped SOL to ${payer.publicKey.toBase58()}`);

    // 2️⃣ Create an account for the greeting counter
    const GREETING_ACCOUNT_SIZE = 4; // Only storing a u32 counter
    const lamports = await connection.getMinimumBalanceForRentExemption(GREETING_ACCOUNT_SIZE);

    const createAccountTx = new Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: greetedAccount.publicKey,
            lamports,
            space: GREETING_ACCOUNT_SIZE,
            programId: PROGRAM_ID,
        })
    );

    await sendAndConfirmTransaction(connection, createAccountTx, [payer, greetedAccount]);
    console.log(`✅ Created greeting account: ${greetedAccount.publicKey.toBase58()}`);

    // 3️⃣ Send a transaction to call the smart contract
    const instruction = new Transaction().add({
        keys: [{ pubkey: greetedAccount.publicKey, isSigner: false, isWritable: true }],
        programId: PROGRAM_ID,
    });

    await sendAndConfirmTransaction(connection, instruction, [payer]);
    console.log(`✅ Called smart contract. Greeting updated!`);

    // 4️⃣ Fetch and display the updated counter
    const accountInfo = await connection.getAccountInfo(greetedAccount.publicKey);
    if (accountInfo) {
        const greetingAccount = borsh.deserialize(GreetingSchema, GreetingAccount, accountInfo.data);
        console.log(`👋 Greeting count: ${greetingAccount.counter}`);
    } else {
        console.log("❌ Failed to retrieve account info");
    }
}

interactWithContract().catch(console.error);
