const corridorLevel = {
	id: "corridor",
	blocks: [
		{
			type: "text",
			kicker: true,
			title: "智华楼一楼走廊",
			src: new URL("./content/intro.html", import.meta.url),
		},
		{
			type: "actions",
			actions: [{ label: "前往图书角", target: "library" }],
		},
	],
};

export default corridorLevel;
