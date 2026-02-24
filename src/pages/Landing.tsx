import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileUpload } from '@/components/FileUpload';

const Landing = () => {
  const [files, setFiles] = useState<File[]>([]);
  const navigate = useNavigate();

  const handleFilesChange = (newFiles: File[]) => {
    setFiles(newFiles);
    // TODO: wire up to script intake flow
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-lg flex flex-col items-center text-center gap-10"
      >
        {/* Wordmark */}
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.6 }}
          className="text-sm font-display font-semibold tracking-[0.25em] uppercase text-muted-foreground/60"
        >
          IFFY
        </motion.span>

        {/* Headline */}
        <div className="space-y-4">
          <h1 className="font-display text-4xl sm:text-5xl font-medium tracking-tight text-foreground leading-[1.1]">
            Drop your script.
            <br />
            Get clarity.
          </h1>
          <p className="text-base text-muted-foreground max-w-sm mx-auto leading-relaxed">
            IFFY analyses your project and tells you exactly what to do next.
          </p>
        </div>

        {/* Upload zone */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="w-full [&_div:first-child>div:first-child]:border-border/40 [&_div:first-child>div:first-child]:bg-background [&_div:first-child>div:first-child]:shadow-[0_2px_24px_-4px_hsl(var(--foreground)/0.06)] [&_div:first-child>div:first-child]:hover:shadow-[0_4px_32px_-4px_hsl(var(--primary)/0.12)] [&_div:first-child>div:first-child]:hover:border-primary/30 [&_div:first-child>div:first-child]:transition-all [&_div:first-child>div:first-child]:duration-500"
        >
          <FileUpload files={files} onFilesChange={handleFilesChange} />
        </motion.div>

        {/* Footnote */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="text-xs text-muted-foreground/50"
        >
          Quick Review takes about 60 seconds.
        </motion.p>

        {/* Existing user link */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          onClick={() => navigate('/auth')}
          className="text-xs text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        >
          Sign in →
        </motion.button>
      </motion.div>
    </div>
  );
};

export default Landing;
