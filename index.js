const express = require("express");
const { Connection, PublicKey } = require("@solana/web3.js");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Use WebSocket RPC for real-time monitoring
const QUICKNODE_WS_URL = "https://wispy-white-field.solana-devnet.quiknode.pro/83e287fade5c7eed29d3e2ae28ce187fe6737281"; 
const connection = new Connection(QUICKNODE_WS_URL, "confirmed");

// ✅ Configuration
const MAX_TXN_HISTORY_CHECK = 10;
const MIN_SOL_BALANCE = 0.01;
const MAX_ACCOUNT_AGE_DAYS = 7;
const TARGET_TOKEN_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"; // Replace with actual token mint address
const MAX_TXNS_PER_SECOND = 3;

let detectedWallets = [];
let txnQueue = [];
let lastProcessedTime = Date.now();

app.use(express.json());

// ✅ Function to check if a transaction involves the target token
async function isTransactionForToken(signature) {
    const txnDetails = await connection.getTransaction(signature, { commitment: "confirmed" });

    if (!txnDetails || !txnDetails.meta || !txnDetails.meta.postTokenBalances) return false;

    return txnDetails.meta.postTokenBalances.some(balance => 
        balance.mint === TARGET_TOKEN_MINT
    );
}

// ✅ Function to get transaction history of a wallet
async function getTransactionHistory(walletAddress) {
    const transactions = await connection.getSignaturesForAddress(
        new PublicKey(walletAddress),
        { limit: MAX_TXN_HISTORY_CHECK }
    );
    return transactions;
}

// ✅ Function to check if a wallet is new (≤ MAX_ACCOUNT_AGE_DAYS old)
async function isWalletNew(walletAddress) {
    const maxTimeDiff = MAX_ACCOUNT_AGE_DAYS * 24 * 60 * 60;
    const transactions = await getTransactionHistory(walletAddress);

    if (transactions.length === 0) return false;

    const firstTxn = transactions[transactions.length - 1];
    if (!firstTxn.blockTime) return false;

    const firstTxnTime = firstTxn.blockTime;
    const currentTime = Math.floor(Date.now() / 1000);

    return (currentTime - firstTxnTime) <= maxTimeDiff;
}

// ✅ Function to check if this is the wallet's first-ever token transaction
async function isFirstTokenTransaction(walletAddress, currentSignature) {
    const transactions = await getTransactionHistory(walletAddress);

    for (const txn of transactions) {
        const txnDetails = await connection.getTransaction(txn.signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
        });
        if (!txnDetails || !txnDetails.meta) continue;

        if (txn.signature === currentSignature) break;

        if (txnDetails.meta.preTokenBalances.length > 0 || txnDetails.meta.postTokenBalances.length > 0) {
            return false;
        }
    }
    return true;
}

// ✅ Function to get SOL balance of a wallet
async function getSolBalance(walletAddress) {
    const balance = await connection.getBalance(new PublicKey(walletAddress));
    return balance / 1e9;
}

// ✅ Process transactions from the queue with rate-limiting
async function processTransactionQueue() {
    if (txnQueue.length === 0) return;

    const now = Date.now();
    if (now - lastProcessedTime < 1000 / MAX_TXNS_PER_SECOND) {
        return; // Ensures rate limit is maintained
    }

    const log = txnQueue.shift();
    lastProcessedTime = now; // Update last processed time

    try {
        const signature = log.signature;
        console.log(`🔍 Checking transaction: ${signature}`);

        // 1️⃣ **Filter transactions not related to the target token**
        if (!(await isTransactionForToken(signature))) {
            console.log(`❌ Skipping txn (Not target token): ${signature}`);
            return;
        }

        // 2️⃣ **Fetch transaction details**
        const txnDetails = await connection.getTransaction(signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
        });

        if (!txnDetails || !txnDetails.transaction) return;

        const walletAddress = txnDetails.transaction.message.accountKeys[0].toBase58();

        // 3️⃣ **Filter out wallets older than MAX_ACCOUNT_AGE_DAYS**
        if (!(await isWalletNew(walletAddress))) {
            console.log(`❌ Skipping txn (Wallet too old): ${walletAddress}`);
            return;
        }

        // 4️⃣ **Check if it's the wallet's first-ever token transaction**
        if (!(await isFirstTokenTransaction(walletAddress, signature))) {
            console.log(`❌ Skipping txn (Not first token txn): ${walletAddress}`);
            return;
        }

        // 5️⃣ **Ensure wallet has at least MIN_SOL_BALANCE**
        const solBalance = await getSolBalance(walletAddress);
        if (solBalance < MIN_SOL_BALANCE) {
            console.log(`❌ Skipping txn (Insufficient SOL): ${walletAddress}`);
            return;
        }

        // ✅ **Wallet detected!**
        console.log(`🚀 New Wallet Detected! ${walletAddress} | Tx: ${signature}`);
        detectedWallets.push({ wallet: walletAddress, signature, solBalance, timestamp: new Date().toISOString() });

    } catch (error) {
        console.error("❌ Error processing transaction:", error);
    }
}

// ✅ WebSocket Listener for token transactions
async function monitorTokenTransactions() {
    connection.onLogs("all", (log) => {
        if (txnQueue.length < MAX_TXNS_PER_SECOND * 2) {
            txnQueue.push(log);
        }
    });

    // Process transactions from queue at a controlled rate
    setInterval(processTransactionQueue, 100);
}

// ✅ API Endpoint to get detected wallets
app.get("/detected-wallets", (req, res) => {
    res.json({ detectedWallets });
});

// ✅ Start the Express Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    monitorTokenTransactions();
    console.log("🔍 Monitoring token transactions in real-time...");
});
