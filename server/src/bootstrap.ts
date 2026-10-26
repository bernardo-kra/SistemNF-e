export type BootstrapOwner = { name: string; email: string; password: string; companyName: string };

export function readBootstrapOwner(env: NodeJS.ProcessEnv): BootstrapOwner {
  const name = env.SISTEM_OWNER_NAME?.trim();
  const email = env.SISTEM_OWNER_EMAIL?.trim().toLowerCase();
  const password = env.SISTEM_OWNER_PASSWORD;
  const companyName = env.SISTEM_COMPANY_NAME?.trim();
  if (!name || name.length > 120 || !companyName || companyName.length > 120)
    throw new Error("Informe o nome do gestor e da empresa, com até 120 caracteres, no ambiente de provisionamento.");
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
    throw new Error("Informe um e-mail válido para o gestor no ambiente de provisionamento.");
  if (!password || password.length < 12 || !password.trim())
    throw new Error("Informe uma senha explícita de pelo menos 12 caracteres no ambiente de provisionamento.");
  return { name, email, password, companyName };
}
