import { apiFetch } from '../services/api';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { InvestorProfile, FUNDRAISING_STAGES, FundraisingStage, InteractionLog, INVESTOR_TYPES } from '../types';
import { cn, formatLocation, getInvestorTypeColorClass } from '../utils';
import { Plus, MoreVertical, Calendar, Mail, Phone, MessageSquare, ChevronDown, DollarSign, Activity, Clock, User, Building2, Target, Upload, Wand2, Trash2, Edit2, FileText, Printer, Download, Search, RefreshCw, CheckCircle2, MapPin, AlignLeft, LayoutGrid } from 'lucide-react';
import { read, utils, writeFile } from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { collection, getDocs, getDoc, addDoc, updateDoc, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from './AuthContext';
import { LocationInput } from './LocationInput';

const STRATOS_OWNERS = [
  "Mike Abbaei",
  "Eric Latin",
  "Daria Sakaris",
  "Cameron Roth",
  "Jeff Musgrove",
  "Winston Bennett",
  "Joe Comizio",
  "Lane Patterson"
];

export const FundraisingCRM = React.memo(function FundraisingCRM() {
  const { user } = useAuth();
  const RESTRICTED_EMAILS = ['arkansas1@gostratos.vc', 'arkansas2@gostratos.vc', 'jcomizio@gostratos.vc', 'lpatterson@gostratos.vc'];
  const isRestrictedUser = Boolean(user?.email && RESTRICTED_EMAILS.includes(user.email.toLowerCase()));

  const [fundFilter, setFundFilter] = useState<'Total' | 'Stratos OF' | 'Arkansas'>(isRestrictedUser ? 'Arkansas' : 'Total');

  useEffect(() => {
    if (isRestrictedUser) {
      setFundFilter('Arkansas');
    }
  }, [isRestrictedUser]);

  const [investors, setInvestors] = useState<InvestorProfile[]>([]);
  const [selectedInvestor, setSelectedInvestor] = useState<InvestorProfile | null>(null);
  const [isAddingInvestor, setIsAddingInvestor] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isAddingActivity, setIsAddingActivity] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isDeletingProfile, setIsDeletingProfile] = useState(false);
  const [editedProfile, setEditedProfile] = useState<Partial<InvestorProfile>>({});
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [newActivity, setNewActivity] = useState<Partial<InteractionLog>>({
    type: 'Meeting',
    notes: '',
    sentiment: 'Neutral',
    date: new Date().toISOString().split('T')[0],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [isAnalyzingEmail, setIsAnalyzingEmail] = useState(false);
  const [newInvestor, setNewInvestor] = useState<Partial<InvestorProfile>>({
    firmName: '',
    website: '',
    linkedin: '',
    calendarLink: '',
    stratosOwner: '',
    description: '',
    leadPartner: '',
    email: '',
    phone: '',
    location: undefined,
    type: '',
    aum: '',
    typicalCheckSize: undefined,
    strategicFit: '',
    stage: 'Identified',
    softCircleAmount: 0,
    warmIntroSource: '',
        probabilityToClose: 0,
    interactions: [],
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
    const filteredInvestors = useMemo(() => {
    if (fundFilter === 'Total') return investors;
    return investors.filter(i => i.fund === fundFilter || (i.funds && i.funds.includes(fundFilter)));
  }, [investors, fundFilter]);

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);


  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return filteredInvestors.filter(i => 
      (i.firmName || '').toLowerCase().includes(query) || 
      (i.leadPartner || '').toLowerCase().includes(query) ||
      (i.type || '').toLowerCase().includes(query) ||
      (i.fund || '').toLowerCase().includes(query)
    ).slice(0, 5);
  }, [searchQuery, filteredInvestors]);

  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = onSnapshot(
      collection(db, 'investors'),
      (snapshot) => {
        let fetchedInvestors: InvestorProfile[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          const interactions = (data.interactions || []).map((i: any) => {
            try {
              const dateObj = new Date(i.date);
              const year = dateObj.getFullYear();
              if (year <= 1970) {
                const ms = dateObj.getTime();
                if (ms > 10000 && ms < 100000) {
                  const recoveredDate = new Date((ms - 25569) * 86400 * 1000);
                  return { ...i, date: recoveredDate.toISOString() };
                }
              }
              return i;
            } catch(e) {
              return i;
            }
          });
          // See useCompanies.ts — this filter silently deleted activity whose
          // date could not be parsed, and the filtered array was written back.
          fetchedInvestors.push({ 
            ...data, 
            id: doc.id,
            interactions
          } as InvestorProfile);
        });
        
        setInvestors(fetchedInvestors);
        setIsLoading(false);
      },
      (error: any) => {
        console.error("Error fetching investors:", error);
        if (error.message?.includes("Database '(default)' not found") || error.code === 'not-found') {
          setError("Firestore Database Not Found: You need to create the Firestore database in your Firebase console.");
        } else if (error.code === 'permission-denied') {
          handleFirestoreError(error, OperationType.GET, 'investors');
        } else {
          setError(error.message || "Failed to connect to Firestore.");
        }
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const handleDownloadPDF = async () => {
    try {
      setIsGeneratingPDF(true);
      
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });
      
      // Title
      doc.setFontSize(20);
      doc.setTextColor(15, 23, 42); // slate-900
      doc.text('Fundraising Status Report', 14, 22);
      
      // Date
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text(`Generated on ${new Date().toLocaleDateString()}`, 14, 30);
      
      // Executive Summary
      doc.setFontSize(14);
      doc.setTextColor(15, 23, 42);
      doc.text('Executive Summary', 14, 45);
      
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text('Total Pipeline Value', 14, 55);
      doc.text('Total Committed', 80, 55);
      doc.text('Active Investors', 150, 55);
      
      doc.setFontSize(16);
      doc.setTextColor(15, 23, 42);
      doc.text(formatCurrency(totalPipelineValue), 14, 63);
      doc.text(formatCurrency(totalCommitted), 80, 63);
      doc.text(String(filteredInvestors.filter(i => i.stage !== 'Closed/Passed').length), 150, 63);
      
      let currentY = 80;
      
      FUNDRAISING_STAGES.forEach(stage => {
        const stageInvestors = filteredInvestors.filter(i => i.stage === stage);
        if (stageInvestors.length === 0) return;
        
        const stageAmount = stageInvestors.reduce((sum, investor) => {
          return sum + (stage === 'Commitment' 
            ? (investor.actualCommitmentAmount ?? investor.softCircleAmount ?? investor.typicalCheckSize ?? 0)
            : (investor.typicalCheckSize ?? 0));
        }, 0);
        
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text(`${stage} (${stageInvestors.length}): ${formatCurrency(stageAmount)}`, 14, currentY);
        
        const splitLongText = (text: any, maxLen: number = 25) => {
          if (!text) return '';
          return String(text).split('\n').map(line => {
            return line.split(' ').map(word => {
              if (word.length > maxLen) {
                return word.match(new RegExp('.{1,' + maxLen + '}', 'g'))?.join('\n') || word;
              }
              return word;
            }).join(' ');
          }).join('\n');
        };

        const tableData = stageInvestors.map(investor => {
          const amount = stage === 'Commitment' 
            ? formatCurrency(investor.actualCommitmentAmount ?? investor.softCircleAmount ?? investor.typicalCheckSize)
            : formatCurrency(investor.typicalCheckSize);
            
          const lastInteraction = (investor.interactions?.length || 0) > 0 
            ? new Date(investor.interactions[0].date).toLocaleDateString()
            : 'No interactions';
            
          const notes = (investor.interactions?.length || 0) > 0 
            ? investor.interactions[0].notes 
            : investor.description || 'No notes available';
            
          return [
            splitLongText(`${investor.firmName}\n${investor.leadPartner}`, 20),
            amount,
            lastInteraction,
            splitLongText(notes, 45)
          ];
        });
        
        autoTable(doc, {
          startY: currentY + 5,
          head: [['Firm / Partner', 'Amount', 'Last Interaction', 'Next Steps / Notes']],
          body: tableData,
          theme: 'grid',
          headStyles: { fillColor: [241, 245, 249], textColor: [71, 85, 105], fontStyle: 'bold' },
          styles: { 
            fontSize: 9, 
            cellPadding: 4, 
            textColor: [15, 23, 42],
            overflow: 'linebreak',
            valign: 'top'
          },
          columnStyles: {
            0: { cellWidth: 45 },
            1: { cellWidth: 25 },
            2: { cellWidth: 25 },
            3: { cellWidth: 'auto' }
          },
          margin: { left: 14, right: 14 }
        });
        
        currentY = (doc as any).lastAutoTable.finalY + 15;
        
        if (currentY > 270) {
          doc.addPage();
          currentY = 20;
        }
      });
      
      doc.save(`Fundraising_Report_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handleDownloadExcel = () => {
    try {
      const wb = utils.book_new();
      
      // Summary Sheet
      const summaryData = [
        ['Fundraising Status Report'],
        [`Generated on ${new Date().toLocaleDateString()}`],
        [],
        ['Executive Summary'],
        ['Total Pipeline Value', formatCurrency(totalPipelineValue)],
        ['Total Committed', formatCurrency(totalCommitted)],
        ['Active Investors', String(filteredInvestors.filter(i => i.stage !== 'Closed/Passed').length)],
        []
      ];
      
      const summaryWs = utils.aoa_to_sheet(summaryData);
      
      // Set column widths for summary sheet
      summaryWs['!cols'] = [
        { wch: 25 }, // Label
        { wch: 20 }  // Value
      ];
      
      utils.book_append_sheet(wb, summaryWs, 'Summary');
      
      // Data Sheet
      const dataRows: any[] = [];
      dataRows.push(['Stage', 'Firm Name', 'Decision Maker', 'Amount', 'Last Interaction', 'Next Steps / Notes']);
      
      FUNDRAISING_STAGES.forEach(stage => {
        const stageInvestors = filteredInvestors.filter(i => i.stage === stage);
        if (stageInvestors.length === 0) return;
        
        stageInvestors.forEach(investor => {
          const amount = stage === 'Commitment' 
            ? (investor.actualCommitmentAmount ?? investor.softCircleAmount ?? investor.typicalCheckSize ?? 0)
            : (investor.typicalCheckSize ?? 0);
            
          const lastInteraction = (investor.interactions?.length || 0) > 0 
            ? new Date(investor.interactions[0].date).toLocaleDateString()
            : 'No interactions';
            
          const rawNotes = (investor.interactions?.length || 0) > 0 
            ? investor.interactions[0].notes 
            : investor.description || 'No notes available';
            
          // Clean up notes for Excel: preserve newlines so Excel automatically wraps the text
          const formattedNotes = String(rawNotes || '')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n');
            
          dataRows.push([
            stage,
            investor.firmName,
            investor.leadPartner,
            amount,
            lastInteraction,
            formattedNotes
          ]);
        });
      });
      
      const dataWs = utils.aoa_to_sheet(dataRows);
      
      // Set column widths for better readability
      dataWs['!cols'] = [
        { wch: 15 }, // Stage
        { wch: 25 }, // Firm Name
        { wch: 20 }, // Decision Maker
        { wch: 15 }, // Amount
        { wch: 18 }, // Last Interaction
        { wch: 80 }  // Next Steps / Notes
      ];
      
      utils.book_append_sheet(wb, dataWs, 'Investors');
      
      writeFile(wb, `Fundraising_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error) {
      console.error('Error generating Excel:', error);
      alert('Failed to generate Excel. Please try again.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const ab = evt.target?.result;
        const wb = read(ab, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = utils.sheet_to_json(ws);
        
        const newInvestors: Omit<InvestorProfile, 'id'>[] = data.map((row: any) => {
          // Try to parse typical check size from string like "$10M" or "1000000"
          let checkSize = 0;
          const rawCheckSize = row['Typical Check Size'] || row['Check Size'] || row['Amount'];
          if (typeof rawCheckSize === 'number') {
            checkSize = rawCheckSize;
          } else if (typeof rawCheckSize === 'string') {
            const cleanStr = rawCheckSize.replace(/[^0-9.MmkK]/g, '');
            if (cleanStr.toLowerCase().includes('m')) {
              checkSize = parseFloat(cleanStr) * 1000000;
            } else if (cleanStr.toLowerCase().includes('k')) {
              checkSize = parseFloat(cleanStr) * 1000;
            } else {
              checkSize = parseFloat(cleanStr) || 0;
            }
          }

          return {
            firmName: row['Firm Name'] || row['Firm'] || row['Company'] || 'Unknown Firm',
            leadPartner: row['Decision Maker'] || row['Partner'] || row['Contact'] || 'Unknown Partner',
            type: row['Type'] || '',
            aum: row['AUM'] || 'Unknown',
            typicalCheckSize: checkSize,
            strategicFit: row['Strategic Fit'] || row['Notes'] || '',
            stage: 'Identified',
            softCircleAmount: 0,
            warmIntroSource: row['Warm Intro Source'] || row['Intro Source'] || '',
            fund: isRestrictedUser ? 'Arkansas' : undefined,
            funds: isRestrictedUser ? ['Arkansas'] : [],
            lastModified: new Date().toISOString(),
            interactions: []
          };
        });

        const addInvestorsToDb = async () => {
          for (const inv of newInvestors) {
            try {
              const cleanInv = Object.fromEntries(
                Object.entries(inv).filter(([_, v]) => v !== undefined)
              );
              await addDoc(collection(db, 'investors'), cleanInv);
            } catch (error: any) {
              console.error("Error adding imported investor:", error);
              alert("Error adding imported investor: " + error.message);
            }
          }
        };
        
        addInvestorsToDb();
      } catch (error) {
        console.error("Error parsing Excel file:", error);
        alert("Failed to parse Excel file. Please ensure it's a valid .xlsx or .csv file.");
      }
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const totalPipelineValue = useMemo(() => {
    return filteredInvestors
      .filter(i => i.stage !== 'Closed/Passed')
      .reduce((sum, i) => sum + (i.typicalCheckSize || 0), 0);
  }, [filteredInvestors]);

  const weightedPipelineValue = useMemo(() => {
    return filteredInvestors
      .filter(i => i.stage !== 'Closed/Passed')
      .reduce((sum, i) => {
        const amount = i.actualCommitmentAmount ?? i.softCircleAmount ?? i.typicalCheckSize ?? 0;
        const probability = (i.probabilityToClose ?? 0) / 100;
        return sum + (amount * probability);
      }, 0);
  }, [filteredInvestors]);

  const totalCommitted = useMemo(() => {
    return filteredInvestors
      .filter(i => i.stage === 'Commitment')
      .reduce((sum, i) => sum + (i.actualCommitmentAmount ?? i.softCircleAmount ?? 0), 0);
  }, [filteredInvestors]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const updateInvestorStage = async (id: string, newStage: FundraisingStage) => {
    try {
      const investorRef = doc(db, 'investors', id);
      const lastModified = new Date().toISOString();
      const investor = investors.find(i => i.id === id);
      
      const updates: any = { stage: newStage, lastModified };
      if (investor && investor.stage !== newStage) {
        const dateStr = new Date(lastModified).toLocaleDateString();
        const newInteraction: InteractionLog = {
          id: Math.random().toString(36).substr(2, 9),
          date: lastModified,
          type: 'Other',
          notes: `Company moved to ${newStage} on ${dateStr}`,
          sentiment: 'Neutral'
        };
        updates.interactions = [newInteraction, ...(investor.interactions || [])];
      }
      
      await updateDoc(investorRef, updates);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, 'investors');
    }
  };

  const handleSaveProfile = async () => {
    if (!selectedInvestor) return;
    try {
      const investorRef = doc(db, 'investors', selectedInvestor.id);
      
      let updatedData = { ...editedProfile };
      
      if (updatedData.actualCommitmentAmount !== undefined && updatedData.actualCommitmentAmount !== null) {
        updatedData.initialCommitmentAmount = updatedData.actualCommitmentAmount * 0.20;
        const mgmtFeePct = updatedData.managementFeePercent !== undefined ? updatedData.managementFeePercent : 2;
        updatedData.managementFeePercent = mgmtFeePct;
        updatedData.annualManagementFee = updatedData.actualCommitmentAmount * (mgmtFeePct / 100);
        updatedData.quarterlyManagementFee = updatedData.annualManagementFee / 4;
      }

      let updatedInteractions = selectedInvestor.interactions || [];
      if (updatedData.stage && updatedData.stage !== selectedInvestor.stage) {
        const nowStr = new Date().toISOString();
        const dateStr = new Date(nowStr).toLocaleDateString();
        const newInteraction: InteractionLog = {
          id: Math.random().toString(36).substr(2, 9),
          date: nowStr,
          type: 'Other',
          notes: `Company moved to ${updatedData.stage} on ${dateStr}`,
          sentiment: 'Neutral'
        };
        updatedInteractions = [newInteraction, ...updatedInteractions];
        updatedData.interactions = updatedInteractions;
      }

      // Remove undefined values to prevent Firestore errors
      const cleanProfile = Object.fromEntries(
        Object.entries(updatedData).filter(([_, v]) => v !== undefined)
      );
      
      await updateDoc(investorRef, cleanProfile);
      const updatedInvestor = { ...selectedInvestor, ...cleanProfile, interactions: updatedInteractions };
      setSelectedInvestor(updatedInvestor as InvestorProfile);
      setIsEditingProfile(false);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, 'investors');
    }
  };

  const handleSelectInvestor = (investor: InvestorProfile | null) => {
    setSelectedInvestor(investor);
    setIsEditingProfile(false);
    setEditedProfile({});
  };

  const handleDeleteProfile = async () => {
    if (!selectedInvestor) return;
    try {
      const investorRef = doc(db, 'investors', selectedInvestor.id);
      await deleteDoc(investorRef);
      setSelectedInvestor(null);
      setIsDeletingProfile(false);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.DELETE, 'investors');
    }
  };

  const handleAnalyzeEmail = async () => {
    if (!newActivity.notes || !selectedInvestor) return;
    setIsAnalyzingEmail(true);
    try {
      const response = await apiFetch('/api/analyze-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailContent: newActivity.notes,
          investorType: selectedInvestor.type
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to analyze email.");
      }
      
      setNewActivity({
        ...newActivity,
        notes: `[AI Summary]\n${data.summary}\n\n[Next Steps]\n${data.nextSteps}\n\n[Original Content]\n${newActivity.notes}`
      });
    } catch (e: any) {
      
      const msg = e.message || '';
      if (msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('429') || msg.toLowerCase().includes('exhausted')) {
        console.warn('Rate limit exceeded. Suppressing error alert.');
      } else {
        alert("Failed to analyze email: " + msg);
      }

    } finally {
      setIsAnalyzingEmail(false);
    }
  };



  const handleGenerateDescription = async () => {
    if (!newInvestor.firmName || !newInvestor.website) {
      alert('Firm name and website are required to generate a description.');
      return;
    }

    setIsGeneratingDescription(true);

    try {
      const response = await apiFetch('/api/describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newInvestor.firmName, website: newInvestor.website }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      if (data.description) {
        setNewInvestor((prev) => ({
          ...prev,
          description: data.description,
        }));
      }
    } catch (err: any) {
      console.error('Failed to generate description:', err);
      let errorMessage = err.message || 'Unknown error';
      if (errorMessage.includes("unregistered callers") || errorMessage.includes("403") || errorMessage.includes("API key is missing")) {
        errorMessage = "Your Gemini API key is missing or invalid. Please click the Settings icon (gear) in the top right, go to Secrets, and add a valid 'API_KEY'. Then refresh the page.";
      }
      
      if (errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('429') || errorMessage.toLowerCase().includes('exhausted')) {
        console.warn('Rate limit exceeded. Suppressing error alert.');
      } else {
        alert(`Failed to generate description: ${errorMessage}. Please try again or fill manually.`);
      }

    } finally {
      setIsGeneratingDescription(false);
    }
  };

  const handleAddInvestor = async () => {
      const investorData: Omit<InvestorProfile, 'id'> = {
      firmName: newInvestor.firmName || 'Unknown Firm',
      website: newInvestor.website || '',
      linkedin: newInvestor.linkedin || '',
      calendarLink: newInvestor.calendarLink || '',
      stratosOwner: newInvestor.stratosOwner || '',
      description: newInvestor.description || '',
      leadPartner: newInvestor.leadPartner || 'Unknown Partner',
      email: newInvestor.email || '',
      phone: newInvestor.phone || '',
      type: newInvestor.type || '',
      aum: newInvestor.aum || '',
      typicalCheckSize: newInvestor.typicalCheckSize || 0,
      strategicFit: newInvestor.strategicFit || '',
      stage: (newInvestor.stage as FundraisingStage) || 'Identified',
      softCircleAmount: newInvestor.softCircleAmount || 0,
      warmIntroSource: newInvestor.warmIntroSource || '',
      fund: isRestrictedUser ? 'Arkansas' : newInvestor.fund,
      funds: isRestrictedUser ? Array.from(new Set([...(newInvestor.funds || []), 'Arkansas'])) : newInvestor.funds,
      lastModified: new Date().toISOString(),
      interactions: [],
    };
    
    try {
      const cleanInv = Object.fromEntries(
        Object.entries(investorData).filter(([_, v]) => v !== undefined)
      );
      await addDoc(collection(db, 'investors'), cleanInv);
      setIsAddingInvestor(false);
      setNewInvestor({
        firmName: '',
        website: '',
        linkedin: '',
        calendarLink: '',
        stratosOwner: '',
        description: '',
        leadPartner: '',
        email: '',
        phone: '',
        type: '',
        aum: '',
        typicalCheckSize: undefined,
        strategicFit: '',
        stage: 'Identified',
        softCircleAmount: 0,
        warmIntroSource: '',
                fund: undefined,
        funds: undefined,
        interactions: [],
      });
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, 'investors');
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center space-y-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        <p className="text-slate-500 dark:text-slate-400">Connecting to database...</p>
      </div>
    );
  }

  if (error) {
    const isNotFound = error.includes("Not Found");
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-6 rounded-lg max-w-lg border border-red-200 dark:border-red-800">
          <h3 className="text-lg font-bold mb-2">Database Error</h3>
          <p className="mb-4">{error}</p>
          <div className="text-sm text-left bg-white dark:bg-slate-900 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
            <p className="font-medium mb-2">How to fix this:</p>
            {isNotFound ? (
              <ol className="list-decimal list-inside space-y-2">
                <li>Go to your <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" className="underline font-medium">Firebase Console</a></li>
                <li>Select your project (<code>gen-lang-client-0128987745</code>)</li>
                <li>Click <strong>Firestore Database</strong> in the left sidebar</li>
                <li>Click the <strong>Create database</strong> button</li>
                <li>Choose a location and start in <strong>Test mode</strong></li>
                <li>Refresh this page</li>
              </ol>
            ) : (
              <ol className="list-decimal list-inside space-y-2">
                <li>Go to your <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" className="underline font-medium">Firebase Console</a></li>
                <li>Make sure you have created a <strong>Firestore Database</strong> (not Realtime Database)</li>
                <li>Go to the <strong>Rules</strong> tab in Firestore</li>
                <li>Set rules to allow read/write for testing:
                  <pre className="mt-2 p-2 bg-slate-100 dark:bg-slate-800 rounded text-xs overflow-x-auto">
{`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}`}
                  </pre>
                </li>
                <li>Publish the rules and refresh this page</li>
              </ol>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <div>
                    <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Fundraising Pipeline</h2>
            {!isRestrictedUser ? (
              <div className="flex items-center gap-1 bg-slate-200/50 dark:bg-slate-800/50 rounded-lg p-1 shadow-inner border border-slate-200 dark:border-slate-800">
                {(['Total', 'Stratos OF', 'Arkansas'] as const).map(option => (
                  <button
                    key={option}
                    onClick={() => setFundFilter(option)}
                    className={`px-4 py-2 text-[0.925rem] font-semibold rounded-lg transition-all duration-300 ${
                      fundFilter === option 
                        ? 'bg-slate-900 text-white shadow-md dark:bg-white dark:text-slate-900' 
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-4 py-2 text-[0.925rem] font-semibold rounded-lg bg-slate-900 text-white shadow-md dark:bg-white dark:text-slate-900">
                Arkansas Overview
              </div>
            )}
          </div>
          <div className="relative mt-4" ref={searchContainerRef}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search investors..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsSearchFocused(true);
                }}
                onFocus={() => setIsSearchFocused(true)}
                className="w-64 pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white transition-shadow"
              />
            </div>
            
            {/* Search Results Dropdown */}
            {isSearchFocused && searchQuery.trim() !== '' && (
              <div className="absolute top-full left-0 mt-2 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg overflow-hidden z-50">
                {searchResults.length > 0 ? (
                  <ul className="py-1">
                    {searchResults.map((investor) => (
                      <li key={investor.id}>
                        <button
                          onClick={() => {
                            handleSelectInvestor(investor);
                            setSearchQuery('');
                            setIsSearchFocused(false);
                          }}
                          className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                        >
                          <div className="font-medium text-slate-900 dark:text-white text-sm truncate">
                            {investor.firmName}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[120px]">{investor.leadPartner}</span>
                            {investor.type && (
                              <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider", getInvestorTypeColorClass(investor.type))}>
                                {investor.type}
                              </span>
                            )}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 text-center">
                    No investors found
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 justify-end">
          <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1 shadow-sm mr-2">
            <button
              onClick={() => setViewMode('kanban')}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                viewMode === 'kanban' 
                  ? "bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white" 
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/50"
              )}
            >
              <LayoutGrid size={16} />
              <span className="hidden sm:inline">Grid View</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                viewMode === 'list' 
                  ? "bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white" 
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/50"
              )}
            >
              <AlignLeft size={16} />
              <span className="hidden sm:inline">List</span>
            </button>
          </div>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept=".xlsx, .xls, .csv" 
            className="hidden" 
          />
          <button 
            onClick={() => setIsReportModalOpen(true)}
            className="flex items-center px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
          >
            <FileText className="w-4 h-4 mr-2" />
            Generate Report
          </button>
          <button 
            onClick={() => {
              if (isRestrictedUser) {
                setNewInvestor(prev => ({
                  ...prev,
                  fund: 'Arkansas',
                  funds: ['Arkansas']
                }));
              }
              setIsAddingInvestor(true);
            }}
            className="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add LP
          </button>
        </div>
      </div>

      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 print:hidden">
        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md p-6 rounded-xl border border-slate-200/60 dark:border-slate-800/60 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/5 flex items-center space-x-4 transition-all hover:shadow-md">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg">
            <Target className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Pipeline Value</p>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{formatCurrency(totalPipelineValue)}</h3>
          </div>
        </div>
        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md p-6 rounded-xl border border-slate-200/60 dark:border-slate-800/60 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/5 flex items-center space-x-4 transition-all hover:shadow-md">
          <div className="p-3 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 rounded-lg">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Weighted Pipeline</p>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{formatCurrency(weightedPipelineValue)}</h3>
          </div>
        </div>
        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md p-6 rounded-xl border border-slate-200/60 dark:border-slate-800/60 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/5 flex items-center space-x-4 transition-all hover:shadow-md">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-lg">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Committed</p>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{formatCurrency(totalCommitted)}</h3>
          </div>
        </div>
        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md p-6 rounded-xl border border-slate-200/60 dark:border-slate-800/60 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/5 flex items-center space-x-4 transition-all hover:shadow-md">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Active Conversations</p>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
              {filteredInvestors.filter(i => i.stage !== 'Identified' && i.stage !== 'Closed/Passed').length}
            </h3>
          </div>
        </div>
      </div>

      {viewMode === 'kanban' ? (
        <div className="pb-4 print:hidden overflow-x-auto">
          {/* Kanban Board */}
          <div className="flex space-x-4 min-w-max pb-2">
            {FUNDRAISING_STAGES.map(stage => {
              const stageInvestors = filteredInvestors.filter(i => i.stage === stage);
              return (
                <div key={stage} className="w-80 flex flex-col bg-slate-100/50 dark:bg-slate-800/20 backdrop-blur-md rounded-xl border border-slate-200/60 dark:border-slate-700/40">
                  <div className="p-4 border-b border-slate-200/60 dark:border-slate-700/40 flex justify-between items-center">
                    <h3 className="font-semibold text-slate-900 dark:text-white">{stage}</h3>
                    <span className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm text-slate-600 dark:text-slate-300 text-xs font-medium px-2.5 py-1 rounded-full shadow-sm ring-1 ring-slate-900/5 dark:ring-white/5">
                      {stageInvestors.length}
                    </span>
                  </div>
                  <div className="p-3 flex-1 space-y-3">
                    {stageInvestors.slice(0, 50).map(investor => (
                      <div 
                        key={investor.id}
                        onClick={() => handleSelectInvestor(investor)}
                        className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md p-4 rounded-lg border border-slate-200/60 dark:border-slate-700/60 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/5 cursor-pointer hover:shadow-md hover:border-indigo-500/50 dark:hover:border-indigo-500/50 hover:-translate-y-0.5 transition-all duration-200 group"
                      >
                        <div className="flex justify-between items-start mb-2 gap-2">
                          <div className="flex flex-col min-w-0 flex-1">
                            <h4 className="font-semibold text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" title={investor.firmName}>{investor.firmName}</h4>
                            {investor.location && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-1">
                                <MapPin size={12} />
                                {formatLocation(investor.location)}
                              </p>
                            )}
                            {investor.website && (
                              <a 
                                href={investor.website} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline mt-1 truncate"
                                onClick={(e) => e.stopPropagation()}
                                title={investor.website}
                              >
                                {investor.website.replace(/^https?:\/\//, '')}
                              </a>
                            )}
                            {investor.type && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider", getInvestorTypeColorClass(investor.type))}>
                                  {investor.type}
                                </span>
                                {investor.fund && !(investor.funds && investor.funds.length > 0) && (
                                  <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                                    {investor.fund}
                                  </span>
                                )}
                                {investor.funds && investor.funds.map(f => (
                                  <span key={f} className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                                    {f}
                                  </span>
                                ))}
                              </div>
                            )}
                            {!investor.type && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {investor.fund && !(investor.funds && investor.funds.length > 0) && (
                                  <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                                    {investor.fund}
                                  </span>
                                )}
                                {investor.funds && investor.funds.map(f => (
                                  <span key={f} className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                                    {f}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="relative shrink-0">
                            <select 
                              value={investor.stage}
                              onChange={(e) => {
                                e.stopPropagation();
                                updateInvestorStage(investor.id, e.target.value as FundraisingStage);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs bg-slate-50/80 dark:bg-slate-800/50 backdrop-blur-sm border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 pl-2.5 pr-7 text-slate-700 dark:text-slate-300 cursor-pointer appearance-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 w-[110px] truncate transition-all hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              {FUNDRAISING_STAGES.map(s => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                            <ChevronDown className="w-3 h-3 absolute right-2.5 top-2 text-slate-400 pointer-events-none" />
                          </div>
                        </div>
                        <div className="space-y-2.5 text-sm mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/60">
                          <div className="flex items-center text-slate-600 dark:text-slate-400 min-w-0">
                            <User className="w-4 h-4 mr-2.5 shrink-0 text-slate-400" />
                            <span className="truncate font-medium" title={investor.leadPartner}>{investor.leadPartner}</span>
                          </div>
                          <div className="flex items-center text-slate-600 dark:text-slate-400 min-w-0">
                            <DollarSign className="w-4 h-4 mr-2.5 shrink-0 text-slate-400" />
                            <span className="truncate font-medium text-slate-700 dark:text-slate-300">
                              {investor.stage === 'Commitment' 
                                ? formatCurrency(investor.actualCommitmentAmount ?? investor.softCircleAmount ?? investor.typicalCheckSize)
                                : formatCurrency(investor.typicalCheckSize)}
                            </span>
                          </div>
                          {(investor.interactions?.length || 0) > 0 && (
                            <div className="mt-2 pt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center min-w-0">
                              <Clock className="w-3.5 h-3.5 mr-2 shrink-0 text-slate-400" />
                              <span className="truncate">Last active: {new Date(investor.interactions[0].date).toLocaleDateString()}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden print:hidden">
          {/* List View */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                  <th className="px-4 py-3">Firm Name</th>
                  <th className="px-4 py-3">Decision Maker</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Typical Check Size</th>
                  <th className="px-4 py-3">Probability to Close</th>
                  <th className="px-4 py-3">Last Interaction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {filteredInvestors.map(investor => (
                  <tr 
                    key={investor.id} 
                    onClick={() => handleSelectInvestor(investor)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors group"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{investor.firmName}</div>
                      {investor.location && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-1">
                          <MapPin size={12} />
                          {formatLocation(investor.location)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                      <div>{investor.leadPartner}</div>
                      {investor.type && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider", getInvestorTypeColorClass(investor.type))}>
                            {investor.type}
                          </span>
                          {investor.fund && !(investor.funds && investor.funds.length > 0) && (
                            <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                              {investor.fund}
                            </span>
                          )}
                          {investor.funds && investor.funds.map(f => (
                            <span key={f} className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                              {f}
                            </span>
                          ))}
                        </div>
                      )}
                      {!investor.type && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {investor.fund && !(investor.funds && investor.funds.length > 0) && (
                            <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                              {investor.fund}
                            </span>
                          )}
                          {investor.funds && investor.funds.map(f => (
                            <span key={f} className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                              {f}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="relative" onClick={(e) => e.stopPropagation()}>
                        <select 
                          value={investor.stage}
                          onChange={(e) => updateInvestorStage(investor.id, e.target.value as FundraisingStage)}
                          className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-1.5 pl-2.5 pr-7 text-slate-700 dark:text-slate-300 cursor-pointer appearance-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 w-[130px] truncate transition-all hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          {FUNDRAISING_STAGES.map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                        <ChevronDown className="w-3 h-3 absolute right-2.5 top-2 text-slate-400 pointer-events-none" />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300 font-medium">
                      {investor.stage === 'Commitment' 
                        ? formatCurrency(investor.actualCommitmentAmount ?? investor.softCircleAmount ?? investor.typicalCheckSize)
                        : formatCurrency(investor.typicalCheckSize)}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <input 
                          type="number" 
                          min="0"
                          max="100"
                          value={investor.probabilityToClose || 0}
                          onChange={async (e) => {
                            const val = parseFloat(e.target.value) || 0;
                            try {
                              const investorRef = doc(db, 'investors', investor.id);
                              await updateDoc(investorRef, { probabilityToClose: val });
                            } catch (error) {
                              handleFirestoreError(error, OperationType.UPDATE, `investors/${investor.id}`);
                            }
                          }}
                          className="w-16 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-1 px-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        />
                        <span className="text-sm text-slate-500 dark:text-slate-400">%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                      {(investor.interactions?.length || 0) > 0 ? (
                        <div className="flex items-center">
                          <Clock className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                          {new Date(investor.interactions[0].date).toLocaleDateString()}
                        </div>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500 italic">No interactions</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredInvestors.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                      No investors found. Add one to get started.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-slate-50 dark:bg-slate-800/80 border-t-2 border-slate-200 dark:border-slate-700 font-semibold text-slate-900 dark:text-white">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right uppercase tracking-wider text-xs text-slate-500 dark:text-slate-400">Totals</td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Total</div>
                    {formatCurrency(totalPipelineValue)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Weighted Total</div>
                    {formatCurrency(weightedPipelineValue)}
                  </td>
                  <td className="px-4 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Investor Detail Modal */}
      {selectedInvestor && (
        <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6 transition-all">
          <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/10">
            <div className="p-6 sm:p-8 border-b border-slate-200/60 dark:border-slate-800/60 flex justify-between items-start gap-4 bg-slate-50/50 dark:bg-slate-800/20">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white break-words tracking-tight">{selectedInvestor.firmName}</h2>
                  {selectedInvestor.total_interactions !== undefined && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-100/80 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border border-indigo-200/50 dark:border-indigo-800/50 shadow-sm">
                      {selectedInvestor.total_interactions} Interactions
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400 break-words flex items-center gap-2">
                  <span className={cn("px-2 py-0.5 rounded-md text-[11px] font-semibold", getInvestorTypeColorClass(selectedInvestor.type))}>{selectedInvestor.type}</span>
                  <span>•</span>
                  <span>{selectedInvestor.aum} AUM</span>
                </p>
              </div>
              <div className="flex items-center space-x-4 shrink-0">
                {!isEditingProfile ? (
                  <button 
                    onClick={() => {
                      setEditedProfile({
                        type: selectedInvestor.type,
                        website: selectedInvestor.website,
                        linkedin: selectedInvestor.linkedin,
                        calendarLink: selectedInvestor.calendarLink,
                        stratosOwner: selectedInvestor.stratosOwner,
                        description: selectedInvestor.description,
                        leadPartner: selectedInvestor.leadPartner,
                        email: selectedInvestor.email,
                        phone: selectedInvestor.phone,
                        location: selectedInvestor.location,
                        typicalCheckSize: selectedInvestor.typicalCheckSize,
                        strategicFit: selectedInvestor.strategicFit,
                        softCircleAmount: selectedInvestor.softCircleAmount,
                        actualCommitmentAmount: selectedInvestor.actualCommitmentAmount,
                        managementFeePercent: selectedInvestor.managementFeePercent || 2,
                        warmIntroSource: selectedInvestor.warmIntroSource,
                        probabilityToClose: selectedInvestor.probabilityToClose || 0,
                      });
                      setIsEditingProfile(true);
                    }}
                    className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                    title="Edit Profile"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                ) : (
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => setIsEditingProfile(false)}
                      className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white px-2 py-1"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleSaveProfile}
                      className="text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded transition-colors"
                    >
                      Save
                    </button>
                  </div>
                )}
                {isDeletingProfile ? (
                  <div className="flex items-center space-x-2 bg-red-50 dark:bg-red-900/20 px-3 py-1.5 rounded-lg border border-red-100 dark:border-red-900/50">
                    <span className="text-sm font-medium text-red-600 dark:text-red-400">Are you sure?</span>
                    <button
                      onClick={handleDeleteProfile}
                      className="text-xs font-bold text-white bg-red-600 hover:bg-red-700 px-2 py-1 rounded transition-colors"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setIsDeletingProfile(false)}
                      className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white px-2 py-1"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsDeletingProfile(true)}
                    className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    title="Delete Profile"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
                <button 
                  onClick={() => {
                    handleSelectInvestor(null);
                    setIsDeletingProfile(false);
                  }}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  ✕
                </button>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-8">
              {/* Profile Details */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">Profile</h3>
                  </div>
                  <div className="space-y-3">
                    {isEditingProfile && (
                      <div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 block">Type</span>
                        <select
                          value={editedProfile.type || ''}
                          onChange={e => setEditedProfile({...editedProfile, type: e.target.value})}
                          className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        >
                          <option value="">Select a type</option>
                          {INVESTOR_TYPES.map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {isEditingProfile ? (
                      <div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 block mb-1">Funds</span>
                        <div className="flex gap-4 items-center">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(editedProfile.funds || []).includes('Arkansas') || editedProfile.fund === 'Arkansas'}
                              onChange={(e) => {
                                const currentFunds = new Set(editedProfile.funds || []);
                                if (editedProfile.fund === 'Arkansas' || editedProfile.fund === 'Stratos OF') {
                                  currentFunds.add(editedProfile.fund);
                                }
                                if (e.target.checked) currentFunds.add('Arkansas');
                                else currentFunds.delete('Arkansas');
                                setEditedProfile(prev => ({ ...prev, funds: Array.from(currentFunds), fund: undefined }));
                              }}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="text-sm text-slate-700 dark:text-slate-300">Arkansas</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(editedProfile.funds || []).includes('Stratos OF') || editedProfile.fund === 'Stratos OF'}
                              onChange={(e) => {
                                const currentFunds = new Set(editedProfile.funds || []);
                                if (editedProfile.fund === 'Arkansas' || editedProfile.fund === 'Stratos OF') {
                                  currentFunds.add(editedProfile.fund);
                                }
                                if (e.target.checked) currentFunds.add('Stratos OF');
                                else currentFunds.delete('Stratos OF');
                                setEditedProfile(prev => ({ ...prev, funds: Array.from(currentFunds), fund: undefined }));
                              }}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="text-sm text-slate-700 dark:text-slate-300">Stratos OF</span>
                          </label>
                        </div>
                      </div>
                    ) : (selectedInvestor.funds && selectedInvestor.funds.length > 0) || selectedInvestor.fund ? (
                      <div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 block">Funds</span>
                        <span className="font-medium text-slate-900 dark:text-white break-words">
                          {(selectedInvestor.funds && selectedInvestor.funds.length > 0) ? selectedInvestor.funds.join(', ') : selectedInvestor.fund}
                        </span>
                      </div>
                    ) : null}
                    <div>
                      <span className="text-sm text-slate-500 dark:text-slate-400 block">Decision Maker</span>
                      {isEditingProfile ? (
                        <input 
                          type="text" 
                          value={editedProfile.leadPartner || ''} 
                          onChange={e => setEditedProfile({...editedProfile, leadPartner: e.target.value})}
                          className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        />
                      ) : (
                        <span className="font-medium text-slate-900 dark:text-white break-words">{selectedInvestor.leadPartner}</span>
                      )}
                    </div>
                    {(isEditingProfile || selectedInvestor.website) && (
                      <div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 block">Website</span>
                        {isEditingProfile ? (
                          <input 
                            type="url" 
                            value={editedProfile.website || ''} 
                            onChange={e => setEditedProfile({...editedProfile, website: e.target.value})}
                            className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          />
                        ) : (
                          <a href={selectedInvestor.website} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline break-all">{selectedInvestor.website?.replace(/^https?:\/\//, '')}</a>
                        )}
                      </div>
                    )}
                    {(isEditingProfile || selectedInvestor.description) && (
                      <div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 block">Description</span>
                        {isEditingProfile ? (
                          <textarea 
                            value={editedProfile.description || ''} 
                            onChange={e => setEditedProfile({...editedProfile, description: e.target.value})}
                            className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                            rows={3}
                          />
                        ) : (
                          <span className="font-medium text-slate-900 dark:text-white whitespace-pre-wrap break-words">{selectedInvestor.description}</span>
                        )}
                      </div>
                    )}
                    {(isEditingProfile || selectedInvestor.linkedin) && (
                      <div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 block">LinkedIn Profile</span>
                        {isEditingProfile ? (
                          <input 
                            type="url" 
                            value={editedProfile.linkedin || ''} 
                            onChange={e => setEditedProfile({...editedProfile, linkedin: e.target.value})}
                            className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          />
                        ) : (
                          <a href={selectedInvestor.linkedin} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline break-all">{selectedInvestor.linkedin?.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, '')}</a>
                        )}
                      </div>
                    )}
                    {(isEditingProfile || selectedInvestor.calendarLink) && (
                      <div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 block">Calendar Link</span>
                        {isEditingProfile ? (
                          <input 
                            type="url" 
                            value={editedProfile.calendarLink || ''} 
                            onChange={e => setEditedProfile({...editedProfile, calendarLink: e.target.value})}
                            className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          />
                        ) : (
                          <a href={selectedInvestor.calendarLink} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline break-all">{selectedInvestor.calendarLink?.replace(/^https?:\/\//, '')}</a>
                        )}
                      </div>
                    )}
                    {(isEditingProfile || selectedInvestor.stratosOwner) && (
                      <div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 block">Stratos Owner</span>
                        {isEditingProfile ? (
                          <select 
                            value={editedProfile.stratosOwner || ''} 
                            onChange={e => setEditedProfile({...editedProfile, stratosOwner: e.target.value})}
                            className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          >
                            <option value="">None</option>
                            {STRATOS_OWNERS.map(owner => (
                              <option key={owner} value={owner}>{owner}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="font-medium text-slate-900 dark:text-white break-words">{selectedInvestor.stratosOwner}</span>
                        )}
                      </div>
                    )}
                    {(isEditingProfile || selectedInvestor.email) && (
                      <div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 block">Email</span>
                        {isEditingProfile ? (
                          <input 
                            type="email" 
                            value={editedProfile.email || ''} 
                            onChange={e => setEditedProfile({...editedProfile, email: e.target.value})}
                            className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          />
                        ) : (
                          <a href={`mailto:${selectedInvestor.email}`} className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline break-all">{selectedInvestor.email}</a>
                        )}
                      </div>
                    )}
                    {(isEditingProfile || selectedInvestor.phone) && (
                      <div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 block">Phone</span>
                        {isEditingProfile ? (
                          <input 
                            type="tel" 
                            value={editedProfile.phone || ''} 
                            onChange={e => setEditedProfile({...editedProfile, phone: e.target.value})}
                            className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          />
                        ) : (
                          <a href={`tel:${selectedInvestor.phone}`} className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline">{selectedInvestor.phone}</a>
                        )}
                      </div>
                    )}
                    {(isEditingProfile || selectedInvestor.location) && (
                      <div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 block">Location</span>
                        {isEditingProfile ? (
                          <LocationInput
                            value={editedProfile.location}
                            onChange={(val) => setEditedProfile({...editedProfile, location: val})}
                            className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          />
                        ) : (
                          <span className="font-medium text-slate-900 dark:text-white break-words">{formatLocation(selectedInvestor.location)}</span>
                        )}
                      </div>
                    )}
                    <div>
                      <span className="text-sm text-slate-500 dark:text-slate-400 block">Typical Check Size</span>
                      {isEditingProfile ? (
                        <input 
                          type="number" 
                          value={editedProfile.typicalCheckSize || ''} 
                          onChange={e => setEditedProfile({...editedProfile, typicalCheckSize: parseFloat(e.target.value) || 0})}
                          className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        />
                      ) : (
                        <span className="font-medium text-slate-900 dark:text-white">{formatCurrency(selectedInvestor.typicalCheckSize)}</span>
                      )}
                    </div>
                    <div>
                      <span className="text-sm text-slate-500 dark:text-slate-400 block">Strategic Fit</span>
                      {isEditingProfile ? (
                        <input 
                          type="text" 
                          value={editedProfile.strategicFit || ''} 
                          onChange={e => setEditedProfile({...editedProfile, strategicFit: e.target.value})}
                          className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        />
                      ) : (
                        <span className="font-medium text-slate-900 dark:text-white break-words">{selectedInvestor.strategicFit}</span>
                      )}
                    </div>
                    
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 uppercase tracking-wider">Momentum</h3>
                  <div className="space-y-3">
                    <div>
                      <span className="text-sm text-slate-500 dark:text-slate-400 block">Current Stage</span>
                      <select 
                        value={selectedInvestor.stage}
                        onChange={(e) => {
                          updateInvestorStage(selectedInvestor.id, e.target.value as FundraisingStage);
                          setSelectedInvestor({ ...selectedInvestor, stage: e.target.value as FundraisingStage });
                        }}
                        className="mt-1 block w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      >
                        {FUNDRAISING_STAGES.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <span className="text-sm text-slate-500 dark:text-slate-400 block">Soft Circle Amount</span>
                      {isEditingProfile ? (
                        <input 
                          type="number" 
                          value={editedProfile.softCircleAmount || ''} 
                          onChange={e => setEditedProfile({...editedProfile, softCircleAmount: parseFloat(e.target.value) || 0})}
                          className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        />
                      ) : (
                        <span className="font-medium text-slate-900 dark:text-white">{formatCurrency(selectedInvestor.softCircleAmount)}</span>
                      )}
                    </div>
                    <div>
                      <span className="text-sm text-slate-500 dark:text-slate-400 block">Warm Intro Source</span>
                      {isEditingProfile ? (
                        <input 
                          type="text" 
                          value={editedProfile.warmIntroSource || ''} 
                          onChange={e => setEditedProfile({...editedProfile, warmIntroSource: e.target.value})}
                          className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        />
                      ) : (
                        <span className="font-medium text-slate-900 dark:text-white break-words">{selectedInvestor.warmIntroSource}</span>
                      )}
                    </div>
                    <div>
                      <span className="text-sm text-slate-500 dark:text-slate-400 block">Probability to Close (%)</span>
                      {isEditingProfile ? (
                        <input 
                          type="number" 
                          min="0"
                          max="100"
                          value={editedProfile.probabilityToClose || ''} 
                          onChange={e => setEditedProfile({...editedProfile, probabilityToClose: parseFloat(e.target.value) || 0})}
                          className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        />
                      ) : (
                        <span className="font-medium text-slate-900 dark:text-white">{selectedInvestor.probabilityToClose || 0}%</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Commitment Stage Details */}
              {selectedInvestor.stage === 'Commitment' && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 uppercase tracking-wider">Commitment Details</h3>
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700 space-y-4">
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 block mb-1">Actual Commitment Amount</span>
                        {isEditingProfile ? (
                          <input 
                            type="number" 
                            value={editedProfile.actualCommitmentAmount || ''} 
                            onChange={e => setEditedProfile({...editedProfile, actualCommitmentAmount: parseFloat(e.target.value) || 0})}
                            className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          />
                        ) : (
                          <span className="font-medium text-slate-900 dark:text-white">{selectedInvestor.actualCommitmentAmount !== undefined ? formatCurrency(selectedInvestor.actualCommitmentAmount) : 'Not specified'}</span>
                        )}
                      </div>
                      <div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 block mb-1">Initial Commitment (20%)</span>
                        <span className="font-medium text-slate-900 dark:text-white">{selectedInvestor.initialCommitmentAmount !== undefined ? formatCurrency(selectedInvestor.initialCommitmentAmount) : '—'}</span>
                      </div>
                      <div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 block mb-1">Management Fee (%)</span>
                        {isEditingProfile ? (
                          <input 
                            type="number" 
                            step="0.1"
                            value={editedProfile.managementFeePercent || ''} 
                            onChange={e => setEditedProfile({...editedProfile, managementFeePercent: parseFloat(e.target.value) || 0})}
                            className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          />
                        ) : (
                          <span className="font-medium text-slate-900 dark:text-white">{selectedInvestor.managementFeePercent !== undefined ? selectedInvestor.managementFeePercent : 2}%</span>
                        )}
                      </div>
                      <div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 block mb-1">Annual Mgmt Fee</span>
                        <span className="font-medium text-slate-900 dark:text-white">{selectedInvestor.annualManagementFee !== undefined ? formatCurrency(selectedInvestor.annualManagementFee) : '—'}</span>
                      </div>
                      <div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 block mb-1">Quarterly Mgmt Fee</span>
                        <span className="font-medium text-slate-900 dark:text-white">{selectedInvestor.quarterlyManagementFee !== undefined ? formatCurrency(selectedInvestor.quarterlyManagementFee) : '—'}</span>
                      </div>
                    </div>
                    <div className="flex flex-col space-y-3">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={selectedInvestor.subscriptionPaperworkSigned || false}
                          onChange={async (e) => {
                            const val = e.target.checked;
                            try {
                              await updateDoc(doc(db, 'investors', selectedInvestor.id), { subscriptionPaperworkSigned: val });
                              setSelectedInvestor({ ...selectedInvestor, subscriptionPaperworkSigned: val });
                            } catch (err) { handleFirestoreError(err, OperationType.UPDATE, 'investors'); }
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Subscription paperwork signed</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={selectedInvestor.amlRequirementsSentByApex || false}
                          onChange={async (e) => {
                            const val = e.target.checked;
                            try {
                              await updateDoc(doc(db, 'investors', selectedInvestor.id), { amlRequirementsSentByApex: val });
                              setSelectedInvestor({ ...selectedInvestor, amlRequirementsSentByApex: val });
                            } catch (err) { handleFirestoreError(err, OperationType.UPDATE, 'investors'); }
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">AML requirements sent by Apex</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={selectedInvestor.allAmlDocumentationReceived || false}
                          onChange={async (e) => {
                            const val = e.target.checked;
                            try {
                              await updateDoc(doc(db, 'investors', selectedInvestor.id), { allAmlDocumentationReceived: val });
                              setSelectedInvestor({ ...selectedInvestor, allAmlDocumentationReceived: val });
                            } catch (err) { handleFirestoreError(err, OperationType.UPDATE, 'investors'); }
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">All AML documentation received</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={selectedInvestor.documentsCountersigned || false}
                          onChange={async (e) => {
                            const val = e.target.checked;
                            try {
                              await updateDoc(doc(db, 'investors', selectedInvestor.id), { documentsCountersigned: val });
                              setSelectedInvestor({ ...selectedInvestor, documentsCountersigned: val });
                            } catch (err) { handleFirestoreError(err, OperationType.UPDATE, 'investors'); }
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Documents countersigned</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={selectedInvestor.fundsReceived || false}
                          onChange={async (e) => {
                            const val = e.target.checked;
                            try {
                              await updateDoc(doc(db, 'investors', selectedInvestor.id), { fundsReceived: val });
                              setSelectedInvestor({ ...selectedInvestor, fundsReceived: val });
                            } catch (err) { handleFirestoreError(err, OperationType.UPDATE, 'investors'); }
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Funds received</span>
                      </label>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Management Fee %</label>
                        <input 
                          type="number" 
                          step="0.01"
                          value={selectedInvestor.managementFeePercent || ''}
                          onChange={async (e) => {
                            const val = parseFloat(e.target.value) || 0;
                            try {
                              await updateDoc(doc(db, 'investors', selectedInvestor.id), { managementFeePercent: val });
                              setSelectedInvestor({ ...selectedInvestor, managementFeePercent: val });
                            } catch (err) { handleFirestoreError(err, OperationType.UPDATE, 'investors'); }
                          }}
                          className="w-full text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md py-1.5 px-3 text-slate-900 dark:text-white"
                          placeholder="e.g. 2.0"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Carry Fee %</label>
                        <input 
                          type="number" 
                          step="0.01"
                          value={selectedInvestor.carryFeePercent || ''}
                          onChange={async (e) => {
                            const val = parseFloat(e.target.value) || 0;
                            try {
                              await updateDoc(doc(db, 'investors', selectedInvestor.id), { carryFeePercent: val });
                              setSelectedInvestor({ ...selectedInvestor, carryFeePercent: val });
                            } catch (err) { handleFirestoreError(err, OperationType.UPDATE, 'investors'); }
                          }}
                          className="w-full text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md py-1.5 px-3 text-slate-900 dark:text-white"
                          placeholder="e.g. 20.0"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Annual Management Fee</label>
                        <input 
                          type="number" 
                          value={selectedInvestor.annualManagementFee || ''}
                          onChange={async (e) => {
                            const val = parseFloat(e.target.value) || 0;
                            try {
                              await updateDoc(doc(db, 'investors', selectedInvestor.id), { annualManagementFee: val });
                              setSelectedInvestor({ ...selectedInvestor, annualManagementFee: val });
                            } catch (err) { handleFirestoreError(err, OperationType.UPDATE, 'investors'); }
                          }}
                          className="w-full text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md py-1.5 px-3 text-slate-900 dark:text-white"
                          placeholder="e.g. 50000"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Quarterly Management Fee</label>
                        <input 
                          type="number" 
                          value={selectedInvestor.quarterlyManagementFee || ''}
                          onChange={async (e) => {
                            const val = parseFloat(e.target.value) || 0;
                            try {
                              await updateDoc(doc(db, 'investors', selectedInvestor.id), { quarterlyManagementFee: val });
                              setSelectedInvestor({ ...selectedInvestor, quarterlyManagementFee: val });
                            } catch (err) { handleFirestoreError(err, OperationType.UPDATE, 'investors'); }
                          }}
                          className="w-full text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md py-1.5 px-3 text-slate-900 dark:text-white"
                          placeholder="e.g. 12500"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Interaction Logs */}
              <div>
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-4">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">Activity Log</h3>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Stage:</label>
                      <select
                        value={selectedInvestor.stage}
                        onChange={async (e) => {
                          const newStage = e.target.value as FundraisingStage;
                          try {
                            const investorRef = doc(db, 'investors', selectedInvestor.id);
                            const updates: any = { stage: newStage };
                            
                            let updatedInteractions = selectedInvestor.interactions || [];
                            if (selectedInvestor.stage !== newStage) {
                              const nowStr = new Date().toISOString();
                              const dateStr = new Date(nowStr).toLocaleDateString();
                              const newInteraction: InteractionLog = {
                                id: Math.random().toString(36).substr(2, 9),
                                date: nowStr,
                                type: 'Other',
                                notes: `Company moved to ${newStage} on ${dateStr}`,
                                sentiment: 'Neutral'
                              };
                              updatedInteractions = [newInteraction, ...updatedInteractions];
                              updates.interactions = updatedInteractions;
                            }
                            
                            await updateDoc(investorRef, updates);
                            setSelectedInvestor({ ...selectedInvestor, stage: newStage, interactions: updatedInteractions });
                          } catch (error: any) {
                            handleFirestoreError(error, OperationType.UPDATE, 'investors');
                          }
                        }}
                        className="rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-1 text-xs font-medium text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm appearance-none"
                      >
                        {FUNDRAISING_STAGES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => setIsAddingActivity(true)}
                      className="text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:text-indigo-700 flex items-center"
                    >
                      <Plus className="w-4 h-4 mr-1" /> Add Activity
                    </button>
                  </div>
                </div>

                {isAddingActivity && (
                  <div className="bg-slate-50/80 dark:bg-slate-800/20 backdrop-blur-md p-5 rounded-lg border border-slate-200/60 dark:border-slate-700/40 mb-6 space-y-4 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/5">
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Date</label>
                        <input 
                          type="date"
                          value={newActivity.date || ''}
                          onChange={e => setNewActivity({...newActivity, date: e.target.value})}
                          className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Type</label>
                        <select 
                          value={newActivity.type}
                          onChange={e => setNewActivity({...newActivity, type: e.target.value as any})}
                          className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        >
                          <option value="Meeting">Meeting</option>
                          <option value="Email">Email</option>
                          <option value="Call">Call</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Sentiment</label>
                        <select 
                          value={newActivity.sentiment}
                          onChange={e => setNewActivity({...newActivity, sentiment: e.target.value as any})}
                          className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        >
                          <option value="Positive">Positive</option>
                          <option value="Neutral">Neutral</option>
                          <option value="Negative">Negative</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Notes / Email Content</label>
                        {newActivity.type === 'Email' && newActivity.notes && (
                          <button
                            type="button"
                            onClick={handleAnalyzeEmail}
                            disabled={isAnalyzingEmail}
                            className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 disabled:opacity-50 transition-colors"
                          >
                            {isAnalyzingEmail ? (
                              <div className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-600/30 border-t-indigo-600 dark:border-indigo-400/30 dark:border-t-indigo-400" />
                            ) : (
                              <Wand2 size={12} />
                            )}
                            Analyze Next Steps
                          </button>
                        )}
                      </div>
                      <textarea 
                        value={newActivity.notes}
                        onChange={e => setNewActivity({...newActivity, notes: e.target.value})}
                        className="w-full text-sm bg-white/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white min-h-[120px] focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono"
                        placeholder={newActivity.type === 'Email' ? "Paste email exchange here to analyze..." : "Enter activity notes..."}
                      />
                    </div>
                    <div className="flex justify-end space-x-2">
                      <button 
                        onClick={() => {
                          setIsAddingActivity(false);
                          setNewActivity({ type: 'Meeting', notes: '', sentiment: 'Neutral', date: new Date().toISOString().split('T')[0] });
                        }}
                        className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={async () => {
                          if (!newActivity.notes) return;
                          
                          // Convert the selected YYYY-MM-DD back to an ISO string, or default to now
                          const activityDate = newActivity.date 
                            ? new Date(newActivity.date + 'T12:00:00Z').toISOString() 
                            : new Date().toISOString();

                          const newInteraction: InteractionLog = {
                            id: Math.random().toString(36).substr(2, 9),
                            date: activityDate,
                            type: newActivity.type as any || 'Meeting',
                            notes: newActivity.notes,
                            sentiment: newActivity.sentiment as any || 'Neutral',
                          };
                          const updatedInteractions = [newInteraction, ...selectedInvestor.interactions];
                          
                          try {
                            const investorRef = doc(db, 'investors', selectedInvestor.id);
                            await updateDoc(investorRef, { interactions: updatedInteractions });
                            
                            const updatedInvestor = {
                              ...selectedInvestor,
                              interactions: updatedInteractions
                            };
                            setSelectedInvestor(updatedInvestor);
                            
                            setIsAddingActivity(false);
                            setNewActivity({ type: 'Meeting', notes: '', sentiment: 'Neutral', date: new Date().toISOString().split('T')[0] });
                          } catch (error: any) {
                            handleFirestoreError(error, OperationType.UPDATE, 'investors');
                          }
                        }}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-medium"
                      >
                        Save Activity
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  {selectedInvestor.interactions.map(interaction => (
                    <div key={interaction.id} className="bg-white/80 dark:bg-slate-900/40 backdrop-blur-md p-5 rounded-lg border border-slate-200/60 dark:border-slate-700/40 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/5">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center space-x-2">
                          {interaction.type === 'Meeting' && <Calendar className="w-4 h-4 text-indigo-500" />}
                          {interaction.type === 'Email' && <Mail className="w-4 h-4 text-emerald-500" />}
                          {interaction.type === 'Call' && <Phone className="w-4 h-4 text-indigo-500" />}
                          {interaction.type === 'Other' && <MessageSquare className="w-4 h-4 text-slate-500" />}
                          <span className="font-medium text-slate-900 dark:text-white">{interaction.type}</span>
                          <span className="text-sm text-slate-500 dark:text-slate-400">•</span>
                          <input
                            type="date"
                            value={interaction.date ? interaction.date.split('T')[0] : ''}
                            onChange={async (e) => {
                              const newDate = e.target.value ? new Date(e.target.value + 'T12:00:00Z').toISOString() : new Date().toISOString();
                              const updatedInteractions = selectedInvestor.interactions.map(i => 
                                i.id === interaction.id ? { ...i, date: newDate } : i
                              );
                              try {
                                const investorRef = doc(db, 'investors', selectedInvestor.id);
                                await updateDoc(investorRef, { interactions: updatedInteractions });
                                setSelectedInvestor({ ...selectedInvestor, interactions: updatedInteractions });
                              } catch (err) {
                                console.error('Failed to update date:', err);
                              }
                            }}
                            className="text-sm bg-transparent border-none text-slate-500 dark:text-slate-400 p-0 focus:ring-0 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer transition-colors"
                          />
                        </div>
                        <span className={cn(
                          "text-xs font-medium px-2 py-1 rounded-full",
                          interaction.sentiment === 'Positive' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
                          interaction.sentiment === 'Negative' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                          "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                        )}>
                          {interaction.sentiment}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 dark:text-slate-300 mb-3 break-words">{interaction.notes}</p>
                      
                      {(interaction.followUpDate || interaction.followUpRequirements) && (
                        <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm">
                          <div className="flex items-center text-amber-600 dark:text-amber-500 font-medium mb-1">
                            <Activity className="w-4 h-4 mr-1" /> Follow-up Required
                          </div>
                          {interaction.followUpDate && (
                            <div className="text-slate-600 dark:text-slate-400 mb-1">
                              <span className="font-medium">Date:</span> {new Date(interaction.followUpDate).toLocaleDateString()}
                            </div>
                          )}
                          {interaction.followUpRequirements && (
                            <div className="text-slate-600 dark:text-slate-400 break-words">
                              <span className="font-medium">Action:</span> {interaction.followUpRequirements}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {(selectedInvestor.interactions?.length || 0) === 0 && (
                    <div className="text-center py-8 text-slate-500 dark:text-slate-400 text-sm">
                      No activities logged yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add LP Modal */}
      {isAddingInvestor && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-start">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Add LP</h2>
              <button 
                onClick={() => setIsAddingInvestor(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Firm Name</label>
                  <input 
                    type="text" 
                    value={newInvestor.firmName} 
                    onChange={e => setNewInvestor({...newInvestor, firmName: e.target.value})}
                    className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    placeholder="e.g. Sequoia Capital"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Website</label>
                  <input 
                    type="url" 
                    value={newInvestor.website || ''} 
                    onChange={e => setNewInvestor({...newInvestor, website: e.target.value})}
                    className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    placeholder="https://example.com"
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Description</label>
                  <button
                    type="button"
                    onClick={handleGenerateDescription}
                    disabled={isGeneratingDescription || !newInvestor.firmName || !newInvestor.website}
                    className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 disabled:opacity-50 transition-colors"
                  >
                    {isGeneratingDescription ? (
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-600/30 border-t-indigo-600 dark:border-indigo-400/30 dark:border-t-indigo-400" />
                    ) : (
                      <Wand2 size={12} />
                    )}
                    Generate with AI
                  </button>
                </div>
                <textarea 
                  value={newInvestor.description || ''} 
                  onChange={e => setNewInvestor({...newInvestor, description: e.target.value})}
                  className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  placeholder="Firm description..."
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Decision Maker</label>
                <input 
                  type="text" 
                  value={newInvestor.leadPartner} 
                  onChange={e => setNewInvestor({...newInvestor, leadPartner: e.target.value})}
                  className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  placeholder="e.g. Roelof Botha"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">LinkedIn Profile</label>
                <input 
                  type="url" 
                  value={newInvestor.linkedin || ''} 
                  onChange={e => setNewInvestor({...newInvestor, linkedin: e.target.value})}
                  className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  placeholder="https://linkedin.com/in/..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Calendar Link</label>
                <input 
                  type="url" 
                  value={newInvestor.calendarLink || ''} 
                  onChange={e => setNewInvestor({...newInvestor, calendarLink: e.target.value})}
                  className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  placeholder="https://calendly.com/..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Stratos Owner</label>
                <select 
                  value={newInvestor.stratosOwner || ''} 
                  onChange={e => setNewInvestor({...newInvestor, stratosOwner: e.target.value})}
                  className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                >
                  <option value="">Select Owner...</option>
                  {STRATOS_OWNERS.map(owner => (
                    <option key={owner} value={owner}>{owner}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
                  <input 
                    type="email" 
                    value={newInvestor.email || ''} 
                    onChange={e => setNewInvestor({...newInvestor, email: e.target.value})}
                    className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    placeholder="e.g. roelof@sequoia.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Phone</label>
                  <input 
                    type="tel" 
                    value={newInvestor.phone || ''} 
                    onChange={e => setNewInvestor({...newInvestor, phone: e.target.value})}
                    className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    placeholder="e.g. (555) 123-4567"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Location</label>
                <LocationInput
                  value={newInvestor.location}
                  onChange={(val) => setNewInvestor({...newInvestor, location: val})}
                  className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  placeholder="e.g. San Francisco, CA"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Type</label>
                  <select
                    value={newInvestor.type || ''}
                    onChange={e => setNewInvestor({...newInvestor, type: e.target.value})}
                    className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  >
                    <option value="">Select a type</option>
                    {INVESTOR_TYPES.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">AUM</label>
                  <input 
                    type="text" 
                    value={newInvestor.aum} 
                    onChange={e => setNewInvestor({...newInvestor, aum: e.target.value})}
                    className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    placeholder="e.g. $85B"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Typical Check Size</label>
                  <input 
                    type="number" 
                    value={newInvestor.typicalCheckSize !== undefined ? newInvestor.typicalCheckSize : ''} 
                    onChange={e => {
                      const val = parseFloat(e.target.value);
                      setNewInvestor({...newInvestor, typicalCheckSize: isNaN(val) ? undefined : val});
                    }}
                    className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    placeholder="e.g. 15000000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Stage</label>
                  <select 
                    value={newInvestor.stage} 
                    onChange={e => setNewInvestor({...newInvestor, stage: e.target.value as FundraisingStage})}
                    className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  >
                    {FUNDRAISING_STAGES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Funds</label>
                  <div className="flex gap-4 items-center">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(newInvestor.funds || []).includes('Arkansas') || newInvestor.fund === 'Arkansas'}
                        onChange={(e) => {
                          const currentFunds = new Set(newInvestor.funds || []);
                          if (newInvestor.fund === 'Arkansas' || newInvestor.fund === 'Stratos OF') {
                            currentFunds.add(newInvestor.fund);
                          }
                          if (e.target.checked) currentFunds.add('Arkansas');
                          else currentFunds.delete('Arkansas');
                          setNewInvestor(prev => ({ ...prev, funds: Array.from(currentFunds), fund: undefined }));
                        }}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm text-slate-700 dark:text-slate-300">Arkansas</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(newInvestor.funds || []).includes('Stratos OF') || newInvestor.fund === 'Stratos OF'}
                        onChange={(e) => {
                          const currentFunds = new Set(newInvestor.funds || []);
                          if (newInvestor.fund === 'Arkansas' || newInvestor.fund === 'Stratos OF') {
                            currentFunds.add(newInvestor.fund);
                          }
                          if (e.target.checked) currentFunds.add('Stratos OF');
                          else currentFunds.delete('Stratos OF');
                          setNewInvestor(prev => ({ ...prev, funds: Array.from(currentFunds), fund: undefined }));
                        }}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm text-slate-700 dark:text-slate-300">Stratos OF</span>
                    </label>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Strategic Fit</label>
                <input 
                  type="text" 
                  value={newInvestor.strategicFit} 
                  onChange={e => setNewInvestor({...newInvestor, strategicFit: e.target.value})}
                  className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  placeholder="e.g. Series A/B, Fintech"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Warm Intro Source</label>
                <input 
                  type="text" 
                  value={newInvestor.warmIntroSource} 
                  onChange={e => setNewInvestor({...newInvestor, warmIntroSource: e.target.value})}
                  className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  placeholder="e.g. Previous Founder"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Probability to Close (%)</label>
                <input 
                  type="number" 
                  min="0"
                  max="100"
                  value={newInvestor.probabilityToClose || ''} 
                  onChange={e => setNewInvestor({...newInvestor, probabilityToClose: parseFloat(e.target.value) || 0})}
                  className="w-full bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg py-2 px-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  placeholder="e.g. 50"
                />
              </div>
            </div>
            <div className="p-6 border-t border-slate-200/60 dark:border-slate-700/60 flex justify-end space-x-3 bg-slate-50/50 dark:bg-slate-900/50">
              <button 
                onClick={() => setIsAddingInvestor(false)}
                className="px-4 py-2 bg-white/50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all shadow-sm"
              >
                Cancel
              </button>
              <button 
                onClick={handleAddInvestor}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-all shadow-sm shadow-blue-500/20"
              >
                Add LP
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {isReportModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:static print:inset-auto">
          <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/10 print:shadow-none print:max-h-none print:overflow-visible print:ring-0">
            <div className="p-6 border-b border-slate-200/60 dark:border-slate-700/60 flex justify-between items-start print:hidden">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center">
                <FileText className="w-6 h-6 mr-2 text-indigo-600" />
                Fundraising Status Report
              </h2>
              <div className="flex items-center space-x-3">
                <button 
                  onClick={handleDownloadExcel}
                  className="flex items-center px-3 py-1.5 bg-slate-100/80 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium transition-all shadow-sm"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Excel
                </button>
                <button 
                  onClick={handleDownloadPDF}
                  disabled={isGeneratingPDF}
                  className="flex items-center px-3 py-1.5 bg-slate-100/80 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium transition-all shadow-sm disabled:opacity-50"
                >
                  {isGeneratingPDF ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-700 dark:border-slate-300 mr-2"></div>
                  ) : (
                    <Printer className="w-4 h-4 mr-2" />
                  )}
                  {isGeneratingPDF ? 'Generating...' : 'Download PDF'}
                </button>
                <button 
                  onClick={() => setIsReportModalOpen(false)}
                  className="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 transition-colors"
                >
                  <Plus className="w-6 h-6 rotate-45" />
                </button>
              </div>
            </div>
            <div ref={reportRef} className="p-6 overflow-y-auto print:overflow-visible print:p-0 bg-white/50 dark:bg-slate-900/50">
              <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2 tracking-tight">Fundraising Status Report</h1>
                <p className="text-slate-500 dark:text-slate-400 font-medium">Generated on {new Date().toLocaleDateString()}</p>
              </div>
              
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Executive Summary</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white/80 dark:bg-slate-800/40 backdrop-blur-sm p-5 rounded-lg border border-slate-200/60 dark:border-slate-700/40 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/5 print:border-slate-300 print:bg-white">
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">Total Pipeline Value</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{formatCurrency(totalPipelineValue)}</p>
                  </div>
                  <div className="bg-white/80 dark:bg-slate-800/40 backdrop-blur-sm p-5 rounded-lg border border-slate-200/60 dark:border-slate-700/40 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/5 print:border-slate-300 print:bg-white">
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">Total Committed</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{formatCurrency(totalCommitted)}</p>
                  </div>
                  <div className="bg-white/80 dark:bg-slate-800/40 backdrop-blur-sm p-5 rounded-lg border border-slate-200/60 dark:border-slate-700/40 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/5 print:border-slate-300 print:bg-white">
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">Active Investors</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{filteredInvestors.filter(i => i.stage !== 'Closed/Passed').length}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-8">
                {FUNDRAISING_STAGES.map(stage => {
                  const stageInvestors = filteredInvestors.filter(i => i.stage === stage);
                  if (stageInvestors.length === 0) return null;
                  
                  const stageAmount = stageInvestors.reduce((sum, investor) => {
                    return sum + (stage === 'Commitment' 
                      ? (investor.actualCommitmentAmount ?? investor.softCircleAmount ?? investor.typicalCheckSize ?? 0)
                      : (investor.typicalCheckSize ?? 0));
                  }, 0);
                  
                  return (
                    <div key={stage} className="break-inside-avoid">
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 border-b border-slate-200/60 dark:border-slate-700/60 pb-2">
                        {stage} ({stageInvestors.length}): {formatCurrency(stageAmount)}
                      </h3>
                      <div className="overflow-x-auto bg-white/80 dark:bg-slate-800/40 backdrop-blur-sm rounded-lg border border-slate-200/60 dark:border-slate-700/40 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/5">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-900/50">
                              <th className="py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Firm / Partner</th>
                              <th className="py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Amount</th>
                              <th className="py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Last Interaction</th>
                              <th className="py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Next Steps / Notes</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                            {stageInvestors.slice(0, 50).map(investor => (
                              <tr key={investor.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition-colors">
                                <td className="py-3 px-4 align-top">
                                  <div className="font-medium text-slate-900 dark:text-white">{investor.firmName}</div>
                                  <div className="text-sm text-slate-500 dark:text-slate-400">{investor.leadPartner}</div>
                                  {investor.type && (
                                    <div className="mt-1">
                                      <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider", getInvestorTypeColorClass(investor.type))}>
                                        {investor.type}
                                      </span>
                                    </div>
                                  )}
                                </td>
                                <td className="py-3 px-4 align-top">
                                  <div className="text-sm font-medium text-slate-900 dark:text-white">
                                    {stage === 'Commitment' 
                                      ? formatCurrency(investor.actualCommitmentAmount ?? investor.softCircleAmount ?? investor.typicalCheckSize)
                                      : formatCurrency(investor.typicalCheckSize)}
                                  </div>
                                </td>
                                <td className="py-3 px-4 align-top">
                                  <div className="text-sm text-slate-500 dark:text-slate-400">
                                    {(investor.interactions?.length || 0) > 0 
                                      ? new Date(investor.interactions[0].date).toLocaleDateString()
                                      : 'No interactions'}
                                  </div>
                                </td>
                                <td className="py-3 px-4 align-top">
                                  <div className="text-sm text-slate-600 dark:text-slate-300">
                                    {(investor.interactions?.length || 0) > 0 
                                      ? investor.interactions[0].notes 
                                      : investor.description || 'No notes available'}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-50 bg-slate-900/95 dark:bg-slate-800/95 backdrop-blur-md text-white px-4 py-3 rounded-lg shadow-lg border border-slate-700/50 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 ring-1 ring-white/10">
          <div className="w-2 h-2 bg-red-500 rounded-full shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
          <p className="text-sm font-medium">{toastMessage}</p>
        </div>
      )}

    </div>
  );
});
