import { Connection, PublicKey } from '@solana/web3.js';
async function run() {
  const connection = new Connection("https://api.devnet.solana.com");
  // using any active pool from the UI
  // let's just fetch all PersonalPositionState
  const accounts = await connection.getProgramAccounts(new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"), {
    filters: [
      { dataSize: 281 } // wait let's calculate LEN properly: 8+1+32+32+4+4+16+16+16+8+8+72+64 = 281
    ]
  });
  console.log("Total PersonalPositionState accounts:", accounts.length);
  if (accounts.length > 0) {
      const data = accounts[0].account.data;
      console.log("tickLower", data.readInt32LE(73));
      console.log("tickUpper", data.readInt32LE(77));
  }
}
run();
