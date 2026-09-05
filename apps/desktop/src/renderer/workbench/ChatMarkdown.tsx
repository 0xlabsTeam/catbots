import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link, Table } from '@cloudflare/kumo';

/** One renderer for partial and saved replies. Raw HTML and remote images stay disabled. */
export function ChatMarkdown({ children }: { children: string }) {
  return <Markdown skipHtml remarkPlugins={[remarkGfm]} components={{
    a: ({ children, href }) => <Link href={href} target="_blank" rel="noopener noreferrer">{children}</Link>,
    img: ({ alt }) => <span>{alt}</span>,
    input: ({ checked }) => <span>{checked ? '✓' : '○'}</span>,
    table: ({ children }) => <div className="chat-markdown-table"><Table>{children}</Table></div>,
    thead: ({ children }) => <Table.Header>{children}</Table.Header>,
    tbody: ({ children }) => <Table.Body>{children}</Table.Body>,
    tr: ({ children }) => <Table.Row>{children}</Table.Row>,
    th: ({ children }) => <Table.Head>{children}</Table.Head>,
    td: ({ children }) => <Table.Cell>{children}</Table.Cell>,
  }}>{children}</Markdown>;
}
