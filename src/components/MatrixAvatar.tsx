import { motion } from "framer-motion";

export type AvatarState =
    | 'idle'
    | 'thinking'
    | 'streaming'
    | 'recording'
    | 'task-created'
    | 'event-created'
    | 'error'
    | 'offline'
    | 'success'
    | 'loading';

interface MatrixAvatarProps {
    compact?: boolean;
    state?: AvatarState;
    onClick?: () => void;
}

function getStateTitle(state: AvatarState): string {
    switch (state) {
        case 'thinking': return 'DerPlanner is thinking...';
        case 'streaming': return 'DerPlanner is responding...';
        case 'recording': return 'DerPlanner is listening...';
        case 'task-created': return 'Task created!';
        case 'event-created': return 'Event scheduled!';
        case 'error': return 'Something went wrong';
        case 'offline': return 'Connection lost';
        case 'success': return 'Completed!';
        default: return 'DerPlanner is ready to help!';
    }
}

function getAvatarImage(state: AvatarState): string {
    switch (state) {
        case 'thinking':
        case 'loading':
        case 'task-created':
        case 'event-created':
        case 'error':
        case 'offline':
            return '/avatar/thinking.gif';
        case 'recording':
            return '/avatar/microphone.gif';
        case 'streaming':
        case 'loading':
            return '/avatar/thinking.gif';
        case 'idle':
        case 'success':
        default:
            return '/avatar/idle.gif';
    }
}

export const MatrixAvatar = ({ compact = false, state = 'idle', onClick }: MatrixAvatarProps) => {
    const imageSize = compact ? { width: 120, height: 150 } : { width: 300, height: 380 };
    const imageSrc = getAvatarImage(state);
    const isActive = state !== 'idle' && state !== 'success';
    return (
        <motion.div
            className={`overflow-visible ${compact
                ? "fixed bottom-[4.5rem] right-[40%] translate-x-[60%] md:translate-x-0 md:right-12 w-[120px] h-[150px] pointer-events-auto cursor-pointer group z-30"
                : "absolute  inset-0 flex items-center justify-center pointer-events-none"
                }`}
            initial={false}
            animate={{
                opacity: compact ? 0.75 : (state === 'offline' ? 0.3 : 0.45),
                scale: isActive ? 1.30 : 1,
            }}
            whileHover={compact ? { opacity: 1 } : undefined}
            transition={{ duration: 0.4, ease: "easeOut" }}
            onClick={compact && onClick ? onClick : undefined}
            title={compact ? (onClick ? "Click to view AI memory" : getStateTitle(state)) : undefined}
        >
            {compact && (
                <motion.div
                    className="absolute inset-0 bg-background/40 backdrop-blur-sm rounded-2xl group-hover:bg-background/50 transition-colors"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5 }}
                />
            )}

            <motion.img
                src={imageSrc}
                alt={getStateTitle(state)}
                width={imageSize.width}
                height={imageSize.height}
                className="relative z-10 object-contain"
                style={{
                    filter: 'drop-shadow(0 4px 12px rgba(255, 127, 0, 0.2))',
                    maxWidth: '100%',
                    maxHeight: '100%'
                }}
            />
        </motion.div>
    );
};

