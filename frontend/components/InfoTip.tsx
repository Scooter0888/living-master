"use client";
import { useState, useRef, useEffect } from "react";
import { Info } from "lucide-react";

interface InfoTipProps {
  text: string;
  width?: number;
  position?: "top" | "bottom" | "left" | "right";
}

export function InfoTip({ text, width = 220, position = "top" }: InfoTipProps) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click (mobile)
  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setVisible(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [visible]);

  const tipStyles: Record<string, React.CSSProperties> = {
    top:    { bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    bottom: { top: "calc(100% + 8px)",   left: "50%", transform: "translateX(-50%)" },
    left:   { right: "calc(100% + 8px)", top: "50%",  transform: "translateY(-50%)" },
    right:  { left:  "calc(100% + 8px)", top: "50%",  transform: "translateY(-50%)" },
  };

  return (
    <div
      ref={ref}
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={() => setVisible(v => !v)}
    >
      <Info
        size={12}
        style={{
          color: visible ? "var(--accent)" : "var(--text-muted)",
          cursor: "help",
          opacity: 0.7,
          flexShrink: 0,
          transition: "color 0.15s",
        }}
      />
      {visible && (
        <div style={{
          position: "absolute",
          ...tipStyles[position],
          width,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "10px 12px",
          fontSize: 12,
          color: "var(--text-secondary)",
          lineHeight: 1.55,
          boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
          zIndex: 200,
          pointerEvents: "none",
          whiteSpace: "normal",
          wordBreak: "break-word",
        }}>
          {text}
          {/* Arrow */}
          <div style={{
            position: "absolute",
            ...(position === "top"    ? { bottom: -5, left: "50%", transform: "translateX(-50%) rotate(45deg)" } :
                position === "bottom" ? { top: -5,    left: "50%", transform: "translateX(-50%) rotate(45deg)" } :
                position === "left"   ? { right: -5,  top: "50%",  transform: "translateY(-50%) rotate(45deg)" } :
                                        { left: -5,   top: "50%",  transform: "translateY(-50%) rotate(45deg)" }),
            width: 8, height: 8,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRight: position === "top" || position === "bottom" ? "1px solid var(--border)" : "none",
            borderBottom: position === "top" ? "1px solid var(--border)" : "none",
            borderTop: position === "bottom" ? "none" : undefined,
            clipPath: position === "top"    ? "polygon(0 100%, 100% 100%, 100% 0)" :
                      position === "bottom" ? "polygon(0 0, 100% 0, 0 100%)" :
                      position === "left"   ? "polygon(100% 0, 100% 100%, 0 100%)" :
                                             "polygon(0 0, 100% 0, 100% 100%)",
          }} />
        </div>
      )}
    </div>
  );
}
