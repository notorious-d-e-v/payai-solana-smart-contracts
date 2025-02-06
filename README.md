README for the PayAI smart contract.

The smart contract facilitates payment between buyers and sellers.
The contract is built using the Anchor framework and is deployed on the Solana blockchain.

Features:
* Payment escrow
* Payment release
* Payment refund
* Admin management

Known limitations:
* The same contract cannot be created more than once, meaning a buyer cannot create a contract for the same seller with the same CID and the same payment amount more than once.

Please create the README below.

# PayAI Smart Contract

The PayAI smart contract facilitates payment between buyers and sellers. The contract is built using the Anchor framework and is deployed on the Solana blockchain.

## Features

* Payment escrow
* Payment release
* Payment refund
* Admin management

## Known Limitations

* The same contract cannot be created more than once, meaning a buyer cannot create a contract for the same seller with the same CID and the same payment amount more than once.

## Installation

1. Clone the repository
```bash
git clone <repository-url>
```

2. Install the dependencies

Follow the instructions in [Getting Started With Anchor](https://solana.com/docs/programs/anchor) to install solana and anchor.

3. Build the program
```bash
anchor build
```

4. Test the program
```bash
anchor test
```

5. Deploy the program
```bash
anchor deploy
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
