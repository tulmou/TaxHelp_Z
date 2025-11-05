pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TaxHelper is ZamaEthereumConfig {
    struct TaxData {
        string encryptedInvoiceData;
        euint32 encryptedRefundAmount;
        uint256 publicTaxRate;
        uint256 publicIncome;
        address userAddress;
        uint256 submissionTime;
        bool isProcessed;
    }

    mapping(string => TaxData) public taxRecords;
    string[] public recordIds;

    event TaxRecordCreated(string indexed recordId, address indexed user);
    event RefundCalculated(string indexed recordId, uint32 refundAmount);

    constructor() ZamaEthereumConfig() {}

    function createTaxRecord(
        string calldata recordId,
        string calldata encryptedInvoiceData,
        externalEuint32 encryptedRefundAmount,
        bytes calldata inputProof,
        uint256 publicTaxRate,
        uint256 publicIncome
    ) external {
        require(bytes(taxRecords[recordId].encryptedInvoiceData).length == 0, "Record already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedRefundAmount, inputProof)), "Invalid encrypted input");

        taxRecords[recordId] = TaxData({
            encryptedInvoiceData: encryptedInvoiceData,
            encryptedRefundAmount: FHE.fromExternal(encryptedRefundAmount, inputProof),
            publicTaxRate: publicTaxRate,
            publicIncome: publicIncome,
            userAddress: msg.sender,
            submissionTime: block.timestamp,
            isProcessed: false
        });

        FHE.allowThis(taxRecords[recordId].encryptedRefundAmount);
        FHE.makePubliclyDecryptable(taxRecords[recordId].encryptedRefundAmount);

        recordIds.push(recordId);
        emit TaxRecordCreated(recordId, msg.sender);
    }

    function calculateRefund(
        string calldata recordId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(taxRecords[recordId].encryptedInvoiceData).length > 0, "Record does not exist");
        require(!taxRecords[recordId].isProcessed, "Refund already calculated");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(taxRecords[recordId].encryptedRefundAmount);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        taxRecords[recordId].isProcessed = true;

        emit RefundCalculated(recordId, decodedValue);
    }

    function getEncryptedRefund(string calldata recordId) external view returns (euint32) {
        require(bytes(taxRecords[recordId].encryptedInvoiceData).length > 0, "Record does not exist");
        return taxRecords[recordId].encryptedRefundAmount;
    }

    function getTaxRecord(string calldata recordId) external view returns (
        string memory encryptedInvoiceData,
        uint256 publicTaxRate,
        uint256 publicIncome,
        address userAddress,
        uint256 submissionTime,
        bool isProcessed
    ) {
        require(bytes(taxRecords[recordId].encryptedInvoiceData).length > 0, "Record does not exist");
        TaxData storage data = taxRecords[recordId];

        return (
            data.encryptedInvoiceData,
            data.publicTaxRate,
            data.publicIncome,
            data.userAddress,
            data.submissionTime,
            data.isProcessed
        );
    }

    function getAllRecordIds() external view returns (string[] memory) {
        return recordIds;
    }

    function serviceStatus() public pure returns (bool operational) {
        operational = true;
    }
}

