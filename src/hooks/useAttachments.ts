import { useState } from 'react';
import { Attachment } from '../types';
import { db, storage } from '../firebase';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { v4 as uuidv4 } from 'uuid';

export function useAttachments(companyId: string | undefined, onUpdateAttachments: (attachments: Attachment[]) => void, currentAttachments: Attachment[] = []) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });

  const uploadFiles = async (files: File[] | FileList) => {
    if (!files || files.length === 0 || !companyId) return;

    setIsUploading(true);
    setUploadProgress({ current: 0, total: files.length });
    const newAttachments: Attachment[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        setUploadProgress({ current: i + 1, total: files.length });
        const file = files[i];

        if (file.name === '.DS_Store' || file.name === 'Thumbs.db' || (file.webkitRelativePath && file.webkitRelativePath.includes('__MACOSX'))) {
           continue;
        }
        
        // Limit file size to 100MB for Firebase Storage
        if (file.size > 100 * 1024 * 1024) {
          alert(`File ${file.name} is too large. Maximum size is 100MB.`);
          continue;
        }

        const fileId = uuidv4();
        const storageRef = ref(storage, `attachments/${companyId}/${fileId}_${file.name}`);
        
        // Upload to Firebase Storage
        await uploadBytes(storageRef, file);
        const downloadUrl = await getDownloadURL(storageRef);

        // Save metadata to Firestore
        await setDoc(doc(db, 'attachments', fileId), {
          companyId: companyId,
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          url: downloadUrl,
          storagePath: storageRef.fullPath,
          createdAt: new Date().toISOString()
        });

        newAttachments.push({
          id: fileId,
          name: file.name,
          url: downloadUrl,
          type: file.type || 'application/octet-stream',
          size: file.size,
        });
      }

      onUpdateAttachments([...currentAttachments, ...newAttachments]);
    } catch (error) {
      console.error("Error uploading file:", error);
      alert("Failed to upload file. Please try again.");
    } finally {
      setIsUploading(false);
      // We don't clear the ref here, the component should handle it if needed
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await uploadFiles(e.target.files!);
  };

  const handleRemoveAttachment = async (attachmentId: string) => {
    if (!companyId) return;
    try {
      // Try to delete from Firestore and Storage
      const docRef = doc(db, 'attachments', attachmentId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.storagePath) {
          const storageRef = ref(storage, data.storagePath);
          await deleteObject(storageRef).catch(console.error);
        }
      }
      await deleteDoc(docRef);
    } catch (err) {
      console.error("Error deleting attachment:", err);
    }
    
    onUpdateAttachments(currentAttachments.filter((a) => a.id !== attachmentId));
  };

  const handleDownloadAttachment = async (attachment: Attachment) => {
    try {
      if (attachment.url.startsWith('http') || attachment.url.startsWith('data:')) {
        window.open(attachment.url, '_blank');
        return;
      }
      
      // Fallback for old base64 attachments stored in Firestore
      const docRef = doc(db, 'attachments', attachment.url);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.data) {
          const a = document.createElement('a');
          a.href = data.data;
          a.download = data.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } else if (data.url) {
          window.open(data.url, '_blank');
        }
      } else {
        alert("File not found in database.");
      }
    } catch (error) {
      console.error("Error downloading file:", error);
      alert("Failed to download file.");
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return {
    isUploading,
    uploadProgress,
    handleFileUpload,
    uploadFiles,
    handleRemoveAttachment,
    handleDownloadAttachment,
    formatFileSize
  };
}
