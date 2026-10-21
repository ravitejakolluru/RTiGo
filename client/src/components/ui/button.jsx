const variants = {
  default: "bg-mint text-ink hover:bg-mint/90",
  outline: "border border-slate-700 bg-transparent text-slate-100 hover:bg-slate-800",
  ghost: "bg-transparent text-slate-300 hover:bg-slate-800",
  destructive: "bg-red-900 text-red-100 hover:bg-red-800",
};

const sizes = {
  default: "h-10 px-4 py-2",
  sm: "h-8 rounded-md px-3 text-xs",
};

export function Button({ className = "", variant = "default", size = "default", ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}
