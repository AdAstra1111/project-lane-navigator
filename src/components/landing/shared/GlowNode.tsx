import { motion } from 'framer-motion';
import { type LucideIcon } from 'lucide-react';

interface Props {
  icon?: LucideIcon;
  label: string;
  color?: string;
  delay?: number;
  active?: boolean;
  onClick?: () => void;
  description?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizes = {
  sm: 'h-12 w-12',
  md: 'h-16 w-16',
  lg: 'h-20 w-20',
};

const iconSizes = {
  sm: 'h-5 w-5',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
};

export function GlowNode({ icon: Icon, label, color = 'hsl(38,60%,52%)', delay = 0, active = false, onClick, description, size = 'md' }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.5, type: 'spring', stiffness: 150 }}
      className="group flex flex-col items-center gap-2 cursor-default"
      onClick={onClick}
    >
      <div
        className={`${sizes[size]} rounded-2xl border flex items-center justify-center backdrop-blur-sm transition-all duration-500 ${active ? 'shadow-[0_0_30px_var(--glow)]' : 'hover:shadow-[0_0_20px_var(--glow)]'}`}
        style={{
          backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
          borderColor: active ? color : `color-mix(in srgb, ${color} 30%, transparent)`,
          '--glow': `color-mix(in srgb, ${color} 40%, transparent)`,
        } as React.CSSProperties}
      >
        {Icon && <Icon className={iconSizes[size]} style={{ color }} />}
      </div>
      <span className="text-xs font-display font-medium text-foreground/70 text-center max-w-[100px]">
        {label}
      </span>
      {description && (
        <motion.p
          initial={{ opacity: 0, height: 0 }}
          whileHover={{ opacity: 1, height: 'auto' }}
          className="text-[10px] text-muted-foreground text-center max-w-[120px] overflow-hidden"
        >
          {description}
        </motion.p>
      )}
    </motion.div>
  );
}
