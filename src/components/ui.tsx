"use client";

import { useEffect, useId, useRef } from "react";
import { Search, X, PackageOpen, ArrowUpRight } from "lucide-react";
import Link from "@/components/demo-link";
import type { Tone } from "@/lib/domain";

export function Badge({
  children,
  tone = "neutral",
  dot = true,
}: {
  children: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="status-dot" />}
      {children}
    </span>
  );
}
export function Avatar({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  return (
    <span className={`avatar ${small ? "avatar-sm" : ""}`}>
      {name
        .split(" ")
        .slice(0, 2)
        .map((s) => s[0])
        .join("")}
    </span>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-actions">{action}</div>
    </div>
  );
}
export function SearchField({
  value,
  onChange,
  placeholder = "Buscar…",
  label = "Buscar registros",
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <label className="search-field">
      <Search size={17} />
      <span className="sr-only">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
export function EmptyState({
  title = "Nenhum resultado encontrado",
  text = "Experimente outra busca ou altere os filtros.",
  action,
}: {
  title?: string;
  text?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <PackageOpen size={28} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Panel({
  title,
  subtitle,
  href,
  linkLabel = "Ver todos",
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {href && (
          <Link className="text-link" href={href}>
            {linkLabel}
            <ArrowUpRight size={15} />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  onCancel,
  onKeyDown,
  wide = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
  onCancel?: React.ReactEventHandler<HTMLDialogElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLDialogElement>;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onCancel={onCancel || onClose}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby={titleId}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Fechar janela"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function FormError({ message }: { message: string }) {
  return message ? (
    <div className="form-error" role="alert">
      {message}
    </div>
  ) : null;
}
export function FormActions({
  onClose,
  label = "Salvar",
  disabled = false,
}: {
  onClose: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div className="form-actions">
      <button
        className="button button-secondary"
        type="button"
        onClick={onClose}
      >
        Cancelar
      </button>
      <button className="button button-primary" type="submit" disabled={disabled}>
        {label}
      </button>
    </div>
  );
}
export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function PaginationInfo({
  count,
  noun = "registros",
}: {
  count: number;
  noun?: string;
}) {
  return (
    <div className="table-footer">
      <span>
        {count} {noun}
      </span>
      <span>Dados de demonstração</span>
    </div>
  );
}
