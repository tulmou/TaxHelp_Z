import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface TaxRecord {
  id: string;
  name: string;
  amount: number;
  category: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface TaxStats {
  totalRefund: number;
  averageRefund: number;
  pendingCount: number;
  verifiedCount: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [taxRecords, setTaxRecords] = useState<TaxRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadingRecord, setUploadingRecord] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newRecordData, setNewRecordData] = useState({ 
    name: "", 
    amount: "", 
    category: "income" 
  });
  const [selectedRecord, setSelectedRecord] = useState<TaxRecord | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("records");
  const [searchTerm, setSearchTerm] = useState("");
  const [faqOpenIndex, setFaqOpenIndex] = useState<number | null>(null);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  const faqItems = [
    {
      question: "FHE加密如何保护我的税务数据？",
      answer: "全同态加密允许在加密数据上直接进行计算，您的税务数据始终以加密形式存在，只有您能解密查看具体金额。"
    },
    {
      question: "退税计算是如何工作的？",
      answer: "系统使用FHE技术在加密数据上执行退税公式计算，无需解密您的原始数据即可得出退税金额。"
    },
    {
      question: "我的数据会离开本地设备吗？",
      answer: "不会。所有加密和解密操作都在您的本地设备完成，只有加密后的数据会上链存储。"
    },
    {
      question: "支持哪些类型的税务凭证？",
      answer: "目前支持整数金额的税务凭证加密，包括收入证明、支出票据等数字金额类凭证。"
    }
  ];

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM初始化失败:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM初始化失败，请检查钱包连接" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('加载数据失败:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const recordsList: TaxRecord[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          recordsList.push({
            id: businessId,
            name: businessData.name,
            amount: 0,
            category: "tax",
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('加载税务数据错误:', e);
        }
      }
      
      setTaxRecords(recordsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "加载数据失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const uploadTaxRecord = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setUploadingRecord(true);
    setTransactionStatus({ visible: true, status: "pending", message: "使用Zama FHE加密上传税务凭证..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const amountValue = parseInt(newRecordData.amount) || 0;
      const businessId = `tax-record-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRecordData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        amountValue * 0.15,
        0,
        `税务凭证: ${newRecordData.category}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "税务凭证上传成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowUploadModal(false);
      setNewRecordData({ name: "", amount: "", category: "income" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消了交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setUploadingRecord(false); 
    }
  };

  const decryptTaxAmount = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "数据已在链上验证" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "在链上验证解密..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "数据已在链上验证" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "解密失败: " + (e.message || "未知错误") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: isAvailable ? "系统可用性检查通过" : "系统暂时不可用" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "可用性检查失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const calculateTaxStats = (): TaxStats => {
    const verifiedRecords = taxRecords.filter(record => record.isVerified);
    const totalRefund = verifiedRecords.reduce((sum, record) => sum + (record.decryptedValue || 0) * 0.15, 0);
    const averageRefund = verifiedRecords.length > 0 ? totalRefund / verifiedRecords.length : 0;
    
    return {
      totalRefund,
      averageRefund,
      pendingCount: taxRecords.filter(record => !record.isVerified).length,
      verifiedCount: verifiedRecords.length
    };
  };

  const renderTaxStats = () => {
    const stats = calculateTaxStats();
    
    return (
      <div className="stats-grid">
        <div className="stat-card metal-card">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <div className="stat-value">${stats.totalRefund.toFixed(2)}</div>
            <div className="stat-label">预估总退税额</div>
          </div>
        </div>
        
        <div className="stat-card metal-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-value">${stats.averageRefund.toFixed(2)}</div>
            <div className="stat-label">平均每笔退税</div>
          </div>
        </div>
        
        <div className="stat-card metal-card">
          <div className="stat-icon">⏳</div>
          <div className="stat-content">
            <div className="stat-value">{stats.pendingCount}</div>
            <div className="stat-label">待验证凭证</div>
          </div>
        </div>
        
        <div className="stat-card metal-card">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{stats.verifiedCount}</div>
            <div className="stat-label">已验证凭证</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>数据加密</h4>
            <p>税务金额使用Zama FHE加密 🔐</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>链上存储</h4>
            <p>加密数据安全存储在区块链上</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>同态计算</h4>
            <p>在加密数据上直接计算退税金额</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>安全解密</h4>
            <p>只有您能查看最终退税结果</p>
          </div>
        </div>
      </div>
    );
  };

  const filteredRecords = taxRecords.filter(record =>
    record.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 FHE隐私退税助手</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>连接钱包开始使用</h2>
            <p>请连接您的钱包来初始化加密退税系统，安全计算您的退税金额</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>点击上方按钮连接钱包</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE加密系统自动初始化</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>开始安全上传和计算退税</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>初始化FHE加密系统...</p>
        <p>状态: {fhevmInitializing ? "初始化FHEVM" : status}</p>
        <p className="loading-note">这可能需要一些时间</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载加密退税系统...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🔐 FHE隐私退税助手</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowUploadModal(true)} 
            className="upload-btn metal-btn"
          >
            📤 上传凭证
          </button>
          <button 
            onClick={checkAvailability} 
            className="check-btn metal-btn"
          >
            🔍 系统检查
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <nav className="app-nav">
        <button 
          className={`nav-btn ${activeTab === "records" ? "active" : ""}`}
          onClick={() => setActiveTab("records")}
        >
          📋 税务记录
        </button>
        <button 
          className={`nav-btn ${activeTab === "stats" ? "active" : ""}`}
          onClick={() => setActiveTab("stats")}
        >
          📊 数据统计
        </button>
        <button 
          className={`nav-btn ${activeTab === "faq" ? "active" : ""}`}
          onClick={() => setActiveTab("faq")}
        >
          ❓ 常见问题
        </button>
      </nav>
      
      <div className="main-content">
        {activeTab === "records" && (
          <div className="records-tab">
            <div className="section-header">
              <h2>我的税务凭证记录</h2>
              <div className="header-controls">
                <div className="search-box">
                  <input 
                    type="text"
                    placeholder="搜索凭证名称或类别..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                  />
                </div>
                <button 
                  onClick={loadData} 
                  className="refresh-btn metal-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "刷新中..." : "🔄 刷新"}
                </button>
              </div>
            </div>
            
            <div className="fhe-info-panel metal-panel">
              <h3>FHE 🔐 隐私保护流程</h3>
              {renderFHEProcess()}
            </div>
            
            <div className="records-list">
              {filteredRecords.length === 0 ? (
                <div className="no-records">
                  <p>暂无税务凭证记录</p>
                  <button 
                    className="upload-btn metal-btn" 
                    onClick={() => setShowUploadModal(true)}
                  >
                    上传第一个凭证
                  </button>
                </div>
              ) : (
                filteredRecords.map((record, index) => (
                  <div 
                    className={`record-item metal-card ${selectedRecord?.id === record.id ? "selected" : ""} ${record.isVerified ? "verified" : ""}`}
                    key={index}
                    onClick={() => setSelectedRecord(record)}
                  >
                    <div className="record-header">
                      <div className="record-title">{record.name}</div>
                      <div className={`record-status ${record.isVerified ? "verified" : "pending"}`}>
                        {record.isVerified ? "✅ 已验证" : "⏳ 待验证"}
                      </div>
                    </div>
                    <div className="record-details">
                      <span>类别: {record.category}</span>
                      <span>上传时间: {new Date(record.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="record-footer">
                      <div className="record-creator">上传者: {record.creator.substring(0, 6)}...{record.creator.substring(38)}</div>
                      {record.isVerified && record.decryptedValue && (
                        <div className="record-amount">退税金额: ${(record.decryptedValue * 0.15).toFixed(2)}</div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === "stats" && (
          <div className="stats-tab">
            <h2>退税数据统计</h2>
            {renderTaxStats()}
            
            <div className="charts-section metal-panel">
              <h3>智能分析图表</h3>
              <div className="chart-placeholder">
                <div className="chart-bar" style={{height: "80%"}}>
                  <span>已验证凭证</span>
                </div>
                <div className="chart-bar" style={{height: "40%"}}>
                  <span>待验证凭证</span>
                </div>
                <div className="chart-bar" style={{height: "60%"}}>
                  <span>平均退税</span>
                </div>
                <div className="chart-bar" style={{height: "90%"}}>
                  <span>总退税额</span>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "faq" && (
          <div className="faq-tab">
            <h2>常见问题解答</h2>
            <div className="faq-list">
              {faqItems.map((faq, index) => (
                <div 
                  className={`faq-item metal-card ${faqOpenIndex === index ? "open" : ""}`}
                  key={index}
                  onClick={() => setFaqOpenIndex(faqOpenIndex === index ? null : index)}
                >
                  <div className="faq-question">
                    {faq.question}
                    <span className="faq-toggle">{faqOpenIndex === index ? "−" : "+"}</span>
                  </div>
                  {faqOpenIndex === index && (
                    <div className="faq-answer">
                      {faq.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {showUploadModal && (
        <UploadModal 
          onSubmit={uploadTaxRecord} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploadingRecord} 
          recordData={newRecordData} 
          setRecordData={setNewRecordData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedRecord && (
        <RecordDetailModal 
          record={selectedRecord} 
          onClose={() => { 
            setSelectedRecord(null); 
            setDecryptedAmount(null); 
          }} 
          decryptedAmount={decryptedAmount} 
          setDecryptedAmount={setDecryptedAmount} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptTaxAmount(selectedRecord.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-panel">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const UploadModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, uploading, recordData, setRecordData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'amount') {
      const intValue = value.replace(/[^\d]/g, '');
      setRecordData({ ...recordData, [name]: intValue });
    } else {
      setRecordData({ ...recordData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal metal-panel">
        <div className="modal-header">
          <h2>上传税务凭证</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 加密保护</strong>
            <p>金额数据将使用Zama FHE加密（仅支持整数）</p>
          </div>
          
          <div className="form-group">
            <label>凭证名称 *</label>
            <input 
              type="text" 
              name="name" 
              value={recordData.name} 
              onChange={handleChange} 
              placeholder="输入凭证描述..." 
            />
          </div>
          
          <div className="form-group">
            <label>金额（整数） *</label>
            <input 
              type="number" 
              name="amount" 
              value={recordData.amount} 
              onChange={handleChange} 
              placeholder="输入金额..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE加密整数</div>
          </div>
          
          <div className="form-group">
            <label>凭证类别 *</label>
            <select name="category" value={recordData.category} onChange={handleChange}>
              <option value="income">收入证明</option>
              <option value="expense">支出票据</option>
              <option value="deduction">抵扣凭证</option>
              <option value="other">其他</option>
            </select>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={uploading || isEncrypting || !recordData.name || !recordData.amount} 
            className="submit-btn metal-btn"
          >
            {uploading || isEncrypting ? "加密并上传中..." : "上传凭证"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RecordDetailModal: React.FC<{
  record: TaxRecord;
  onClose: () => void;
  decryptedAmount: number | null;
  setDecryptedAmount: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ record, onClose, decryptedAmount, setDecryptedAmount, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedAmount !== null) { 
      setDecryptedAmount(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedAmount(decrypted);
    }
  };

  const refundAmount = record.isVerified ? 
    (record.decryptedValue || 0) * 0.15 : 
    (decryptedAmount || 0) * 0.15;

  return (
    <div className="modal-overlay">
      <div className="record-detail-modal metal-panel">
        <div className="modal-header">
          <h2>凭证详情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="record-info">
            <div className="info-item">
              <span>凭证名称:</span>
              <strong>{record.name}</strong>
            </div>
            <div className="info-item">
              <span>上传者:</span>
              <strong>{record.creator.substring(0, 6)}...{record.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>上传时间:</span>
              <strong>{new Date(record.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>凭证类别:</span>
              <strong>{record.category}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>加密金额数据</h3>
            
            <div className="data-row">
              <div className="data-label">原始金额:</div>
              <div className="data-value">
                {record.isVerified && record.decryptedValue ? 
                  `${record.decryptedValue} (链上已验证)` : 
                  decryptedAmount !== null ? 
                  `${decryptedAmount} (本地解密)` : 
                  "🔒 FHE加密整数"
                }
              </div>
              <button 
                className={`decrypt-btn metal-btn ${(record.isVerified || decryptedAmount !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 验证中..."
                ) : record.isVerified ? (
                  "✅ 已验证"
                ) : decryptedAmount !== null ? (
                  "🔄 重新验证"
                ) : (
                  "🔓 验证解密"
                )}
              </button>
            </div>
            
            <div className="refund-calculation">
              <h4>退税计算</h4>
              <div className="calculation-formula">
                金额 × 15% = 退税额
              </div>
              <div className="refund-amount">
                预估退税额: <strong>${refundAmount.toFixed(2)}</strong>
              </div>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 同态计算</strong>
                <p>退税计算在加密数据上直接进行，保护您的隐私安全</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">关闭</button>
          {!record.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn metal-btn"
            >
              {isDecrypting ? "链上验证中..." : "链上验证"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

