<?php

use Twig\Environment;
use Twig\Loader\FilesystemLoader;

require_once __DIR__.'/vendor/autoload.php';

$loader = new FilesystemLoader(__DIR__.'/templates');

$twig = new Environment($loader);

$templates = [
	'/' => 'auth.html.twig',
];

$route = $_SERVER['REQUEST_URI'] ?? '/';

if (!array_key_exists($route, $templates)) {
	http_response_code(404);
	echo 'Not found';
	exit;
}

$apiBaseUrl = getenv('API_BASE_URL') ?: 'http://localhost:3000';

echo $twig->render($templates[$route], [
	'api_base_url' => $apiBaseUrl,
]);
