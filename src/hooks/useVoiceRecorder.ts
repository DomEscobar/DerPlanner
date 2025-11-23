import { useState, useRef, useCallback } from 'react';

export interface UseVoiceRecorderOptions {
  onTranscription?: (text: string) => void;
  onError?: (error: string) => void;
  onPermissionStatus?: (status: 'requesting' | 'denied' | 'error' | 'granted') => void;
}

export const useVoiceRecorder = (options: UseVoiceRecorderOptions = {}) => {
  const { onTranscription, onError, onPermissionStatus } = options;
  
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingStartTimeRef = useRef<number>(0);

  const startRecording = useCallback(async () => {
    try {
      if (mediaRecorderRef.current?.state === 'recording') {
        return;
      }

      let stream = streamRef.current;
      
      if (!stream) {
        // Check if permission is already granted to avoid showing the modal unnecessarily
        let shouldShowPrompt = true;
        try {
          const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          if (permissionStatus.state === 'granted') {
            shouldShowPrompt = false;
          }
        } catch (e) {
          // If permission query fails or is not supported, we assume we need to show prompt
        }

        if (shouldShowPrompt) {
          onPermissionStatus?.('requesting');
        }
        
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
          } 
        });
        
        streamRef.current = stream;
        onPermissionStatus?.('granted');
      }
      
      audioChunksRef.current = [];
      recordingStartTimeRef.current = Date.now();

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      
    } catch (error) {
      console.error('Error starting recording:', error);
      setIsRecording(false);
      
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          onPermissionStatus?.('denied');
          onError?.('Microphone permission denied. Please enable permissions in your browser settings.');
        } else if (error.name === 'NotFoundError') {
          onPermissionStatus?.('error');
          onError?.('No microphone found. Please check your device.');
        } else {
          onPermissionStatus?.('error');
          onError?.('Failed to access microphone. Please check permissions.');
        }
      } else {
        onPermissionStatus?.('error');
        onError?.('Failed to access microphone. Please check permissions.');
      }
    }
  }, [onError, onPermissionStatus]);

  const stopRecording = useCallback(async () => {
    return new Promise<Blob | null>((resolve) => {
      const recorder = mediaRecorderRef.current;
      
      if (!recorder || recorder.state === 'inactive') {
        resolve(null);
        return;
      }

      const recordingDuration = Date.now() - recordingStartTimeRef.current;
      
      const onStop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        
        setIsRecording(false);
        resolve(audioBlob);
      };

      recorder.onstop = onStop;
      
      if (recordingDuration < 500) {
        onError?.('Recording too short. Hold the microphone for at least half a second.');
        resolve(null);
      }
      
      recorder.stop();
    });
  }, [onError]);

  const transcribeAudio = useCallback(async (audioBlob: Blob, userId: string) => {
    setIsProcessing(true);
    
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('userId', userId);

      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const response = await fetch(`${apiUrl}/api/transcribe`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Transcription failed');
      }

      const transcription = data.data.text;
      onTranscription?.(transcription);
      return transcription;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Transcription failed';
      console.error('Transcription error:', errorMessage);
      onError?.(errorMessage);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [onTranscription, onError]);

  const requestPermission = useCallback(async () => {
    try {
      // If we already have a stream, permission is already granted
      if (streamRef.current) {
        onPermissionStatus?.('granted');
        return;
      }

      // Check if permission is already granted to avoid showing the modal unnecessarily
      let shouldShowPrompt = true;
      try {
        const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (permissionStatus.state === 'granted') {
          shouldShowPrompt = false;
        }
      } catch (e) {
        // If permission query fails or is not supported, we assume we need to show prompt
      }

      if (shouldShowPrompt) {
        onPermissionStatus?.('requesting');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          } 
      });
      
      streamRef.current = stream;
      onPermissionStatus?.('granted');
      
    } catch (error) {
      console.error('Error requesting permission:', error);
      
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          onPermissionStatus?.('denied');
          onError?.('Microphone permission denied. Please enable permissions in your browser settings.');
        } else if (error.name === 'NotFoundError') {
          onPermissionStatus?.('error');
          onError?.('No microphone found. Please check your device.');
        } else {
          onPermissionStatus?.('error');
          onError?.('Failed to access microphone. Please check permissions.');
        }
      } else {
        onPermissionStatus?.('error');
        onError?.('Failed to access microphone. Please check permissions.');
      }
    }
  }, [onError, onPermissionStatus]);

  const recordAndTranscribe = useCallback(async (userId: string) => {
    const audioBlob = await stopRecording();
    
    if (!audioBlob || audioBlob.size === 0) {
      return null;
    }

    return await transcribeAudio(audioBlob, userId);
  }, [stopRecording, transcribeAudio, onError]);

  const cancelRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    
    if (!recorder || recorder.state === 'inactive') {
      return;
    }

    recorder.stop();
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    audioChunksRef.current = [];
    setIsRecording(false);
  }, []);

  return {
    isRecording,
    isProcessing,
    startRecording,
    stopRecording,
    recordAndTranscribe,
    cancelRecording,
    requestPermission,
  };
};

