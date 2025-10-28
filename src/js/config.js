export const CONFIG = {
    "forum_title": "BlurtBB",
    "DEFAULT_THEME": "flatly", // The default Bootswatch theme. User can override this in their settings.
    "main_tag": "blurtbb",
    "tag_prefix": "fdsfdsf-",
    "admins": ["fervi"],
    "moderators": [],
    "RPC_NODES": [
        "https://rpc.blurt.world",
        "https://blurt-rpc.saboin.com",
        "https://rpc.beblurt.com",
        "https://blurtrpc.dagobert.uk"
    ],
    "category_groups": [
        {
            "group_title": "Welcome",
            "categories": [
                {
                    "id": "announcements",
                    "title": "Announcements",
                    "description": "Official news and updates from the team."
                },
                {
                    "id": "introductions",
                    "title": "Introductions",
                    "description": "Say hello and introduce yourself to the community."
                },
                {
                    "id": "support",
                    "title": "Help & Support",
                    "description": "Get help with using the forum or Blurt."
                }
            ]
        },
        {
            "group_title": "Blurt Ecosystem",
            "categories": [
                {
                    "id": "general",
                    "title": "General Discussion",
                    "description": "General chat about the Blurt blockchain."
                },
                {
                    "id": "development",
                    "title": "Development & DApps",
                    "description": "Discuss technical details, development, and applications on Blurt."
                },
                {
                    "id": "trading",
                    "title": "Trading & Markets",
                    "description": "Price, markets, and speculation."
                }
            ]
        },
        {
            "group_title": "Community",
            "categories": [
                {
                    "id": "witnesses",
                    "title": "Witnesses",
                    "description": "Discussions about Blurt witnesses."
                },
                {
                    "id": "off-topic",
                    "title": "Off-Topic",
                    "description": "For everything else."
                }
            ]
        }
    ]
};