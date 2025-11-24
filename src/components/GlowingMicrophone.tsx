import { motion } from 'framer-motion';
import { Mic } from 'lucide-react';

interface GlowingMicrophoneProps {
  isRecording: boolean;
  isProcessing: boolean;
  disabled?: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export const GlowingMicrophone = ({
  isRecording,
  isProcessing,
  disabled = false,
  onPointerDown,
  onTouchStart,
  onContextMenu,
}: GlowingMicrophoneProps) => {
  return (
    <motion.div
      whileHover={!disabled ? { scale: 1.05 } : {}}
      whileTap={!disabled ? { scale: 0.95 } : {}}
      className="relative"
    >
      {/* Outer glow ring */}
      <motion.div
        animate={isRecording ? { rotate: 360 } : {}}
        transition={{ duration: 3, repeat: isRecording ? Infinity : 0, ease: 'linear' }}
        className={`absolute inset-0 rounded-full ${
          isRecording
            ? 'bg-gradient-to-r from-red-500/30 via-pink-500/30 to-red-500/30'
            : 'bg-gradient-to-r from-blue-400/25 via-blue-300/25 to-blue-400/25'
        } blur-2xl`}
        style={{ filter: 'blur(20px)' }}
      />

      {/* Middle glow ring */}
      <motion.div
        animate={isRecording ? { rotate: -360 } : {}}
        transition={{ duration: 4, repeat: isRecording ? Infinity : 0, ease: 'linear' }}
        className={`absolute inset-0 rounded-full ${
          isRecording
            ? 'bg-gradient-to-r from-pink-500/20 to-red-500/20'
            : 'bg-gradient-to-r from-blue-300/15 to-blue-400/15'
        } blur-xl`}
        style={{ filter: 'blur(15px)', inset: '8px' }}
      />

      {/* Main button with 3D effect */}
      <motion.button
        onPointerDown={onPointerDown}
        onTouchStart={onTouchStart}
        onContextMenu={onContextMenu}
        disabled={disabled}
        className={`relative h-20 w-20 rounded-full border-4 border-background shadow-2xl transition-all flex items-center justify-center ${
          isRecording
            ? 'bg-gradient-to-br from-red-500/80 to-pink-600/80 backdrop-blur-xl text-white shadow-red-500/60 hover:shadow-red-600/80'
            : isProcessing
              ? 'bg-gradient-to-br from-blue-400/70 to-blue-500/70 backdrop-blur-xl text-white animate-pulse shadow-blue-500/60'
              : 'bg-gradient-to-br from-blue-300/60 to-blue-400/60 backdrop-blur-2xl text-blue-900 dark:text-blue-100 shadow-lg hover:shadow-xl hover:-translate-y-1 hover:from-blue-300/80 hover:to-blue-400/80'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        style={{
          touchAction: 'none',
          WebkitTouchCallout: 'none',
          textShadow: '0 0 10px rgba(0,0,0,0.1)',
        }}
      >
        {/* 3D inner shadow for glossy effect */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/40 to-transparent" />

        {/* Icon container with glow */}
        <div className="relative z-10 flex items-center justify-center">
          {isProcessing ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            >
              <Mic className="h-8 w-8 drop-shadow-lg" />
            </motion.div>
          ) : (
            <Mic className="h-8 w-8 drop-shadow-lg" />
          )}
        </div>

        {/* Ripple effect when recording */}
        {isRecording && (
          <>
            <motion.div
              initial={{ opacity: 0.5, scale: 1 }}
              animate={{ opacity: 0, scale: 1.8 }}
              transition={{ repeat: Infinity, duration: 1.2 }}
              className="absolute inset-0 rounded-full bg-white/20"
            />
            <motion.div
              initial={{ opacity: 0.3, scale: 1 }}
              animate={{ opacity: 0, scale: 2 }}
              transition={{ repeat: Infinity, duration: 1.5, delay: 0.2 }}
              className="absolute inset-0 rounded-full bg-white/10"
            />
          </>
        )}
      </motion.button>
    </motion.div>
  );
};

