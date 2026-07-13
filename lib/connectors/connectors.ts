export interface ConnectorDef {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  authType: "dcr" | "oauth";
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  icon: string;
  brandColor: string;
  website: string;
}

export const CONNECTORS: ConnectorDef[] = [
  {
    id: "linear",
    name: "Linear",
    description: "Issue tracking and project management",
    endpoint: "https://mcp.linear.app/mcp",
    authType: "dcr",
    icon: "linear",
    brandColor: "#5E6AD2",
    website: "https://linear.app",
  },
  {
    id: "atlassian",
    name: "Atlassian",
    description: "Jira issue tracking + Confluence wiki",
    endpoint: "https://mcp.atlassian.com/v1/mcp",
    authType: "dcr",
    icon: "atlassian",
    brandColor: "#0052CC",
    website: "https://atlassian.com",
  },
  {
    id: "trello",
    name: "Trello",
    description: "Kanban boards and task management",
    endpoint: "https://mcp.atlassian.com/v1/mcp",
    authType: "dcr",
    icon: "trello",
    brandColor: "#0052CC",
    website: "https://trello.com",
  },
  {
    id: "airtable",
    name: "Airtable",
    description: "Spreadsheet-database hybrid platform",
    endpoint: "https://mcp.airtable.com/mcp",
    authType: "dcr",
    icon: "airtable",
    brandColor: "#FFBF00",
    website: "https://airtable.com",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Docs, wikis, and project management",
    endpoint: "https://mcp.notion.com/mcp",
    authType: "dcr",
    icon: "notion",
    brandColor: "currentColor",
    website: "https://notion.so",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Team messaging and collaboration",
    endpoint: "https://mcp.slack.com/mcp",
    authType: "oauth",
    clientId: "",
    clientSecret: "",
    scopes: ["channels:read", "chat:write", "users:read"],
    icon: "slack",
    brandColor: "#4A154B",
    website: "https://slack.com",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Code hosting and collaboration",
    endpoint: "https://api.githubcopilot.com/mcp/",
    authType: "oauth",
    clientId: "",
    clientSecret: "",
    scopes: ["repo", "read:user"],
    icon: "github",
    brandColor: "currentColor",
    website: "https://github.com",
  },
  {
    id: "google",
    name: "Google Workspace",
    description: "Gmail, Calendar, and Drive",
    endpoint: "",
    authType: "oauth",
    clientId: "",
    clientSecret: "",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
    icon: "google",
    brandColor: "#4285F4",
    website: "https://workspace.google.com",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    description: "CRM and marketing platform",
    endpoint: "https://mcp.hubspot.com",
    authType: "oauth",
    clientId: "",
    clientSecret: "",
    scopes: ["crm.objects.contacts.read", "crm.objects.deals.read"],
    icon: "hubspot",
    brandColor: "#FF7A59",
    website: "https://hubspot.com",
  },
  {
    id: "asana",
    name: "Asana",
    description: "Project and task management",
    endpoint: "https://mcp.asana.com/v2/mcp",
    authType: "oauth",
    clientId: "",
    clientSecret: "",
    scopes: ["default"],
    icon: "asana",
    brandColor: "#F06A6A",
    website: "https://asana.com",
  },
  {
    id: "dropbox",
    name: "Dropbox",
    description: "Cloud file storage and sharing",
    endpoint: "https://mcp.dropbox.com/mcp",
    authType: "dcr",
    icon: "dropbox",
    brandColor: "#0061FF",
    website: "https://dropbox.com",
  },

];

export function getConnector(id: string): ConnectorDef | undefined {
  return CONNECTORS.find((c) => c.id === id);
}
