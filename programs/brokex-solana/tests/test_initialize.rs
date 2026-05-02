use anchor_lang::InstructionData;
use brokex_solana::instruction::Initialize;
use litesvm::LiteSVM;
use solana_instruction::Instruction;
use solana_message::{Message, VersionedMessage};
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_keypair::Keypair;
use solana_transaction::versioned::VersionedTransaction;

#[test]
fn test_initialize() {
    // LiteSVM expects Solana 2.x modular crates; Anchor uses 3.x pubkeys/instructions in-process.
    let program_id = Pubkey::new_from_array(brokex_solana::id().to_bytes());
    let payer = Keypair::new();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/brokex_solana.so");
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let instruction = Instruction::new_with_bytes(program_id, &Initialize {}.data(), vec![]);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());
}
